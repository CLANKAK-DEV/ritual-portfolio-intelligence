import { createPublicClient, defineChain, http, parseAbi } from "viem";

const chain = defineChain({
  id: 1979,
  name: "Ritual Chain",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org"] } },
});

const addresses = {
  http: "0x0000000000000000000000000000000000000801",
  llm: "0x0000000000000000000000000000000000000802",
  scheduler: "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B",
  wallet: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
  tracker: "0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5",
  registry: "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F",
  models: "0x7A85F48b971ceBb75491b61abe279728F4c4384f",
};

const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
const [chainId, blockNumber, codes, httpServices, llmServices, modelExists] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  Promise.all(Object.entries(addresses).map(async ([name, address]) => [name, await client.getCode({ address })])),
  ...[0, 1].map((capability) => client.readContract({
    address: addresses.registry,
    abi: parseAbi(["function getServicesByCapability(uint8 capability, bool checkValidity) view returns (((address paymentAddress,address teeAddress,uint8 teeType,bytes publicKey,string endpoint,bytes32 certPubKeyHash,uint8 capability) node,bool isValid,bytes32 workloadId)[])"]),
    functionName: "getServicesByCapability",
    args: [capability, true],
  })),
  client.readContract({
    address: addresses.models,
    abi: parseAbi(["function modelExists(string model) view returns (bool)"]),
    functionName: "modelExists",
    args: ["zai-org/GLM-4.7-FP8"],
  }),
]);

const contracts = Object.fromEntries(codes.map(([name, code]) => [name, typeof code === "string" && code !== "0x"]));
console.log(JSON.stringify({
  chainId,
  blockNumber: blockNumber.toString(),
  deployedSystemBytecode: contracts,
  nativePrecompiles: { http: addresses.http, llm: addresses.llm },
  healthyHttpExecutors: httpServices.length,
  healthyLlmExecutors: llmServices.length,
  model: { name: "zai-org/GLM-4.7-FP8", registered: modelExists },
}, null, 2));
