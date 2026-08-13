# Nova Era Venduss

Central de pendências para acompanhar clientes desde o primeiro atendimento até a solução final.

## Funcionalidades

- cadastro de cliente, WhatsApp, valor, prioridade e descrição da pendência;
- fila com novos casos, atendimentos em andamento e clientes aguardando retorno;
- histórico de observações e mudanças de status;
- soluções por crédito em produtos, novo pedido, reembolso parcelado ou outro acordo;
- geração automática e controle das parcelas de reembolso;
- painel com quantidade e valores pendentes e resolvidos;
- aprovação de atendentes e perfis de administrador;
- interface responsiva para computador e celular.

## Banco de dados

O projeto usa Supabase Auth e tabelas exclusivas com prefixo `nev_`. As migrations ficam em [`supabase/migrations`](supabase/migrations). As tabelas públicas possuem Row Level Security (RLS) e não liberam dados para visitantes sem autenticação.

## Configuração segura

Por segurança, a URL, a chave publicável do Supabase e o token inicial do administrador não ficam gravados no repositório público.

1. Copie `.env.example` para `.env.local`.
2. Preencha `NEXT_PUBLIC_SUPABASE_URL`.
3. Preencha `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Depois das migrations, configure o acesso inicial diretamente no banco por um canal privado.

## Desenvolvimento

Requer Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Validações:

```bash
npm run lint
npm test
```

O cliente web usa apenas a chave publicável do Supabase. Nunca inclua uma chave `service_role` no navegador.

## Instalação no servidor

O instalador para Ubuntu 22.04 e Nginx Proxy Manager usa o domínio `vendussnovaera.venduss.com`, uma porta e um container exclusivos e não reinicia os outros sistemas do servidor.

```bash
curl -fsSL https://raw.githubusercontent.com/uniquessatacado/vendussnovaera/main/server/install.sh -o /tmp/vendussnovaera-install.sh && sudo bash /tmp/vendussnovaera-install.sh
```

Atualizações posteriores:

```bash
curl -fsSL https://raw.githubusercontent.com/uniquessatacado/vendussnovaera/main/server/update.sh -o /tmp/vendussnovaera-update.sh && sudo bash /tmp/vendussnovaera-update.sh
```
