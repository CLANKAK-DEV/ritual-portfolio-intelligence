// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address user) external view returns (uint256);
    function lockUntil(address user) external view returns (uint256);
}

interface IScheduler {
    function schedule(
        bytes calldata data,
        uint32 gasLimit,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId);

    function cancel(uint256 callId) external;
}

/// @title Ritual Portfolio Intelligence
/// @notice Fetches wallet holdings through Ritual HTTP and analyzes them through Ritual LLM.
/// @dev HTTP and LLM are deliberately separate transactions: Ritual permits one SPC call per tx.
contract PortfolioIntelligence {
    address public constant HTTP_PRECOMPILE = address(0x0801);
    address public constant LLM_PRECOMPILE = address(0x0802);
    IRitualWallet public constant RITUAL_WALLET =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);
    IScheduler public constant SCHEDULER =
        IScheduler(0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B);

    struct Snapshot {
        uint64 fetchedAt;
        uint64 analyzedAt;
        uint16 httpStatus;
        bytes32 portfolioHash;
        bytes32 analysisHash;
        bytes portfolioJson;
        string analysisJson;
        string analysisError;
    }

    struct StorageRef {
        string platform;
        string path;
        string keyRef;
    }

    address public owner;
    string public apiBaseUrl;
    string public apiUrlSuffix;
    uint256 public activeScheduleId;
    mapping(address => Snapshot) private snapshots;

    error NotOwner();
    error NotScheduler();
    error InvalidAddress();
    error InvalidUrl();
    error InvalidSchedule();
    error PrecompileCallFailed(address precompile);
    error HTTPRequestFailed(uint16 status, string reason);
    error MissingPortfolio();
    error PortfolioTooLarge(uint256 bytesLength);
    error FeeWithdrawalLocked(uint256 lockUntilBlock);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ApiBaseUrlUpdated(string previousUrl, string newUrl);
    event ApiUrlSuffixUpdated(string previousSuffix, string newSuffix);
    event PortfolioFetched(
        address indexed wallet,
        bytes32 indexed portfolioHash,
        uint16 status,
        uint256 bytesLength,
        uint256 executionIndex
    );
    event AnalysisCompleted(
        address indexed wallet,
        bytes32 indexed analysisHash,
        string model,
        bool hasError
    );
    event AnalysisFailed(address indexed wallet, string reason);
    event RefreshScheduled(uint256 indexed callId, address indexed wallet, uint32 frequency, uint32 numCalls);
    event ScheduleCancelled(uint256 indexed callId);
    event FeesDeposited(address indexed beneficiary, uint256 amount, uint256 lockDuration);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyScheduler() {
        if (msg.sender != address(SCHEDULER)) revert NotScheduler();
        _;
    }

    constructor(string memory initialApiBaseUrl, string memory initialApiUrlSuffix) {
        owner = msg.sender;
        _setApiBaseUrl(initialApiBaseUrl);
        apiUrlSuffix = initialApiUrlSuffix;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Transfers administration to a new address.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    /// @notice Changes the HTTPS endpoint used by Ritual HTTP executors.
    function setApiBaseUrl(string calldata newUrl) external onlyOwner {
        _setApiBaseUrl(newUrl);
    }

    /// @notice Changes the path appended after the wallet address in HTTP requests.
    function setApiUrlSuffix(string calldata newSuffix) external onlyOwner {
        string memory previous = apiUrlSuffix;
        apiUrlSuffix = newSuffix;
        emit ApiUrlSuffixUpdated(previous, newSuffix);
    }

    /// @notice Deposits caller-owned execution fees into RitualWallet.
    function depositForCaller(uint256 lockDuration) external payable {
        RITUAL_WALLET.depositFor{value: msg.value}(msg.sender, lockDuration);
        emit FeesDeposited(msg.sender, msg.value, lockDuration);
    }

    /// @notice Deposits fees owned by this contract for scheduled executions.
    function depositScheduledFees(uint256 lockDuration) external payable onlyOwner {
        RITUAL_WALLET.deposit{value: msg.value}(lockDuration);
        emit FeesDeposited(address(this), msg.value, lockDuration);
    }

    /// @notice Withdraws unlocked scheduled-execution funds to the owner.
    function withdrawScheduledFees(uint256 amount) external onlyOwner {
        uint256 lockedUntil = RITUAL_WALLET.lockUntil(address(this));
        if (block.number < lockedUntil) revert FeeWithdrawalLocked(lockedUntil);
        RITUAL_WALLET.withdraw(amount);
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert PrecompileCallFailed(address(RITUAL_WALLET));
        emit FeesWithdrawn(owner, amount);
    }

    /// @notice Fetches a normalized wallet snapshot using Ritual's HTTP precompile.
    function refreshPortfolio(address wallet, address httpExecutor) external {
        _refreshPortfolio(wallet, httpExecutor, 0);
    }

    /// @notice Scheduler entrypoint. The Scheduler injects executionIndex into the first argument.
    function refreshFromScheduler(
        uint256 executionIndex,
        address wallet,
        address httpExecutor
    ) external onlyScheduler {
        _refreshPortfolio(wallet, httpExecutor, executionIndex);
    }

    /// @notice Runs Ritual-native LLM analysis over the latest stored portfolio.
    function analyzePortfolio(
        address wallet,
        address llmExecutor,
        string calldata model
    ) external {
        bytes memory portfolioJson = snapshots[wallet].portfolioJson;
        if (portfolioJson.length == 0) revert MissingPortfolio();
        if (portfolioJson.length > 6_000) revert PortfolioTooLarge(portfolioJson.length);
        bytes memory llmInput = _encodeLlmInput(llmExecutor, model, portfolioJson);

        (bool ok, bytes memory rawOutput) = LLM_PRECOMPILE.call(llmInput);
        if (!ok) revert PrecompileCallFailed(LLM_PRECOMPILE);
        (, bytes memory actualOutput) = abi.decode(rawOutput, (bytes, bytes));

        bytes memory modelMetadata;
        StorageRef memory updatedConvoHistory;
        bool hasError;
        bytes memory completionData;
        string memory errorMessage;
        (hasError, completionData, modelMetadata, errorMessage, updatedConvoHistory) =
            abi.decode(actualOutput, (bool, bytes, bytes, string, StorageRef));

        Snapshot storage snapshot = snapshots[wallet];
        snapshot.analyzedAt = uint64(block.timestamp);

        if (hasError) {
            snapshot.analysisError = errorMessage;
            emit AnalysisFailed(wallet, errorMessage);
            emit AnalysisCompleted(wallet, bytes32(0), model, true);
            return;
        }

        string memory content = _extractCompletionContent(completionData);
        snapshot.analysisJson = content;
        snapshot.analysisError = "";
        snapshot.analysisHash = keccak256(bytes(content));
        emit AnalysisCompleted(wallet, snapshot.analysisHash, model, false);
    }

    /// @notice Schedules recurring Ritual HTTP refreshes.
    function scheduleRefresh(
        address wallet,
        address httpExecutor,
        uint32 startBlock,
        uint32 frequency,
        uint32 numCalls,
        uint32 gasLimit,
        uint32 schedulerTtl,
        uint256 maxFeePerGas
    ) external onlyOwner returns (uint256 callId) {
        if (wallet == address(0) || httpExecutor == address(0)) revert InvalidAddress();
        if (frequency == 0 || numCalls == 0 || uint256(frequency) * numCalls > 10_000) {
            revert InvalidSchedule();
        }

        bytes memory data = abi.encodeWithSelector(
            this.refreshFromScheduler.selector,
            uint256(0),
            wallet,
            httpExecutor
        );

        callId = SCHEDULER.schedule(
            data,
            gasLimit,
            startBlock,
            numCalls,
            frequency,
            schedulerTtl,
            maxFeePerGas,
            0,
            0,
            address(this)
        );
        activeScheduleId = callId;
        emit RefreshScheduled(callId, wallet, frequency, numCalls);
    }

    /// @notice Cancels the current recurring refresh schedule.
    function cancelSchedule() external onlyOwner {
        uint256 callId = activeScheduleId;
        if (callId == 0) revert InvalidSchedule();
        SCHEDULER.cancel(callId);
        activeScheduleId = 0;
        emit ScheduleCancelled(callId);
    }

    /// @notice Returns the complete latest snapshot for a wallet.
    function getSnapshot(address wallet) external view returns (Snapshot memory) {
        return snapshots[wallet];
    }

    /// @notice Returns the RitualWallet balance and lock for this contract.
    function scheduledFeeStatus() external view returns (uint256 balance, uint256 lockUntilBlock) {
        return (
            RITUAL_WALLET.balanceOf(address(this)),
            RITUAL_WALLET.lockUntil(address(this))
        );
    }

    function _refreshPortfolio(address wallet, address httpExecutor, uint256 executionIndex) internal {
        if (wallet == address(0) || httpExecutor == address(0)) revert InvalidAddress();
        string memory url = string.concat(apiBaseUrl, _addressToHex(wallet), apiUrlSuffix);

        string[] memory headerKeys = new string[](1);
        string[] memory headerValues = new string[](1);
        headerKeys[0] = "Accept";
        headerValues[0] = "application/json";

        bytes memory input = abi.encode(
            httpExecutor,
            new bytes[](0),
            uint256(300),
            new bytes[](0),
            bytes(""),
            url,
            uint8(1),
            headerKeys,
            headerValues,
            bytes(""),
            uint256(0),
            uint8(0),
            false
        );

        (bool ok, bytes memory rawOutput) = HTTP_PRECOMPILE.call(input);
        if (!ok) revert PrecompileCallFailed(HTTP_PRECOMPILE);
        (, bytes memory actualOutput) = abi.decode(rawOutput, (bytes, bytes));
        (
            uint16 status,
            ,
            ,
            bytes memory body,
            string memory errorMessage
        ) = abi.decode(actualOutput, (uint16, string[], string[], bytes, string));

        if (bytes(errorMessage).length > 0 || status < 200 || status >= 300) {
            revert HTTPRequestFailed(status, errorMessage);
        }

        Snapshot storage snapshot = snapshots[wallet];
        snapshot.fetchedAt = uint64(block.timestamp);
        snapshot.httpStatus = status;
        snapshot.portfolioJson = body;
        snapshot.portfolioHash = keccak256(body);
        emit PortfolioFetched(wallet, snapshot.portfolioHash, status, body.length, executionIndex);
    }

    function _extractCompletionContent(bytes memory completionData) internal pure returns (string memory) {
        string memory completionId;
        string memory objectType;
        uint256 createdAt;
        string memory completionModel;
        string memory systemFingerprint;
        string memory serviceTier;
        uint256 choicesCount;
        bytes[] memory choicesData;
        bytes memory usageData;
        (
            completionId,
            objectType,
            createdAt,
            completionModel,
            systemFingerprint,
            serviceTier,
            choicesCount,
            choicesData,
            usageData
        ) = abi.decode(
            completionData,
            (string, string, uint256, string, string, string, uint256, bytes[], bytes)
        );
        if (choicesCount == 0 || choicesData.length == 0) return "";

        (, , bytes memory messageData) = abi.decode(choicesData[0], (uint256, string, bytes));
        (, string memory content, , , ) = abi.decode(
            messageData,
            (string, string, string, uint256, bytes[])
        );
        return content;
    }

    function _encodeLlmInput(
        address llmExecutor,
        string calldata model,
        bytes memory portfolioJson
    ) internal pure returns (bytes memory) {
        if (llmExecutor == address(0)) revert InvalidAddress();
        string memory messages = string.concat(
            '[{"role":"system","content":"You are a cautious portfolio risk analyst. Return only valid JSON with keys riskScore, grade, riskLabel, summary, observations, and actions. Never provide financial advice."},',
            '{"role":"user","content":"Analyze this TEE-fetched wallet payload: ',
            _escapeJsonString(portfolioJson),
            '"}]'
        );
        return abi.encode(
            llmExecutor,
            new bytes[](0),
            uint256(300),
            new bytes[](0),
            bytes(""),
            messages,
            model,
            int256(0),
            "",
            false,
            int256(4096),
            "",
            "",
            uint256(1),
            true,
            int256(0),
            "medium",
            _responseFormatData(),
            int256(-1),
            "auto",
            "",
            false,
            int256(700),
            bytes(""),
            bytes(""),
            int256(-1),
            int256(1000),
            "",
            false,
            StorageRef("", "", "")
        );
    }

    function _responseFormatData() internal pure returns (bytes memory) {
        string memory schema = '{"type":"object","properties":{"riskScore":{"type":"integer","minimum":0,"maximum":100},"grade":{"type":"string"},"riskLabel":{"type":"string","enum":["Low","Moderate","Elevated","High"]},"summary":{"type":"string"},"observations":{"type":"array","items":{"type":"string"}},"actions":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"detail":{"type":"string"},"impact":{"type":"string","enum":["high","medium","low"]}},"required":["title","detail","impact"]}}},"required":["riskScore","grade","riskLabel","summary","observations","actions"]}';
        bytes memory jsonSchema = abi.encode(
            "portfolio_analysis",
            "Risk analysis for a wallet portfolio",
            schema,
            "true"
        );
        return abi.encode("json_schema", jsonSchema);
    }

    function _escapeJsonString(bytes memory input) internal pure returns (string memory) {
        bytes memory output = new bytes(input.length * 2);
        uint256 length;
        for (uint256 i = 0; i < input.length; ++i) {
            bytes1 char = input[i];
            if (char == bytes1('"') || char == bytes1('\\')) {
                output[length++] = bytes1('\\');
                output[length++] = char;
            } else if (char == bytes1('\n')) {
                output[length++] = bytes1('\\');
                output[length++] = bytes1('n');
            } else if (char == bytes1('\r')) {
                output[length++] = bytes1('\\');
                output[length++] = bytes1('r');
            } else if (char == bytes1('\t')) {
                output[length++] = bytes1('\\');
                output[length++] = bytes1('t');
            } else {
                output[length++] = char;
            }
        }
        assembly {
            mstore(output, length)
        }
        return string(output);
    }

    function _setApiBaseUrl(string memory newUrl) internal {
        bytes memory value = bytes(newUrl);
        if (value.length < 9) revert InvalidUrl();
        bytes8 prefix;
        assembly {
            prefix := mload(add(value, 32))
        }
        if (prefix != bytes8("https://")) revert InvalidUrl();
        string memory previous = apiBaseUrl;
        apiBaseUrl = newUrl;
        emit ApiBaseUrlUpdated(previous, newUrl);
    }

    function _addressToHex(address account) internal pure returns (string memory) {
        bytes20 value = bytes20(account);
        bytes16 symbols = "0123456789abcdef";
        bytes memory output = new bytes(42);
        output[0] = "0";
        output[1] = "x";
        for (uint256 i = 0; i < 20; ++i) {
            output[2 + i * 2] = symbols[uint8(value[i] >> 4)];
            output[3 + i * 2] = symbols[uint8(value[i] & 0x0f)];
        }
        return string(output);
    }

    receive() external payable {}
}
