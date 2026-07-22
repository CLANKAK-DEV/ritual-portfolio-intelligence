# Security Policy

## Secret handling

Never commit credentials to this repository.

- Put web-provider credentials in `.env.local`.
- Put contract deployment credentials in `.env.ritual` or another ignored local environment file.
- Use encrypted environment variables in the production hosting platform.
- Never prefix a secret with `NEXT_PUBLIC_`; values using that prefix are included in browser code.
- Never include a provider key in a smart-contract constructor, calldata, event, or Ritual HTTP request. On-chain data is public.
- Commit only `.env.example`, and keep every value in it empty or demonstrably public.

The repository ignores `.env*` and explicitly allows only `.env.example`. Run the following check before every push:

```bash
npm run security:check
```

The same check runs in GitHub Actions.

## If a credential is exposed

1. Revoke or rotate it immediately at the provider.
2. Replace the encrypted production secret.
3. Remove it from the working tree and Git history before sharing the repository.
4. Review provider usage and deployment activity for unauthorized access.

Deleting a secret in a later commit is not sufficient because it remains in Git history.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, or private wallet information. Use GitHub's private security-advisory feature for this repository.
