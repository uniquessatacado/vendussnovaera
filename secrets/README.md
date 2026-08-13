# Arquivos privados

Esta pasta existe apenas para organizar arquivos privados na máquina local ou no servidor.
Todo o conteúdo dela é ignorado pelo Git, com exceção deste aviso.

- Nunca coloque chaves `service_role`, `sb_secret_`, senhas ou certificados no repositório.
- Use `.env.local` no desenvolvimento.
- No servidor, mantenha os arquivos de ambiente com permissão `600`.
- A chave `sb_publishable_` usada pelo navegador é pública e não deve ser tratada como segredo.
