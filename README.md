# WhatsApp Bot Template

Template em Node.js para criar um bot de atendimento no WhatsApp e adaptar o mesmo projeto a diferentes nichos: serviços, produtos digitais, suporte, pequenos negócios e catálogos.

O projeto inclui menu por palavras-chave, catálogo configurável, fluxo básico de compra, persistência local de pedidos em JSON e integração **opcional** com PIX da NexusPag e webhook. Não inclui IA, banco de dados externo ou painel administrativo.

> Este projeto usa `whatsapp-web.js`, uma biblioteca que automatiza o WhatsApp Web. Ela não é uma API oficial da Meta e pode sofrer mudanças de compatibilidade. Use conforme os termos aplicáveis ao seu uso.

## 1. Requisitos

- Node.js 20 ou superior.
- WhatsApp no celular para escanear o QR Code na primeira conexão.
- Para pagamentos automáticos: uma conta e credenciais válidas da NexusPag (ou configure para outro gateway), além de uma URL pública para receber webhooks.

## 2. Instalar no Windows

Abra o terminal dentro da pasta do projeto e execute:

```bash
npm install
```

Crie seu arquivo de ambiente copiando `.env.example` para `.env`. No PowerShell:

```powershell
Copy-Item .env.example .env
```

No Prompt de Comando (CMD):

```bat
copy .env.example .env
```

Depois, personalize `BUSINESS_NAME` no `.env` e edite o arquivo `config.js`.

## 3. Iniciar o bot

```bash
npm start
```

Na primeira execução, escaneie o QR Code com o WhatsApp. No celular, abra **Aparelhos conectados** e escolha a opção para conectar um aparelho. A sessão fica salva localmente na pasta de autenticação criada pela biblioteca; não publique essa pasta.

Para verificar a sintaxe dos arquivos JavaScript:

```bash
npm run check
```

## 4. Personalizar para outro nicho

Quase toda personalização inicial fica em `config.js`:

- `business.name` e `business.description`: nome e descrição do negócio.
- `commands`: palavras que ativam menu, compra, suporte e tutorial.
- `products`: catálogo, preços, aliases, descrição, duração e forma de entrega.
- `links`: URLs de tutoriais, suporte e termos.
- `messages`: textos de atendimento, pagamento e entrega.

Exemplo de produto:

```js
{
    id: 'consultoria_30min',
    name: 'Consultoria de 30 minutos',
    aliases: ['1', 'consultoria', 'consulta'],
    price: 35.00,
    description: 'Atendimento individual de 30 minutos.',
    durationDays: null,
    fulfillment: {
        type: 'manual',
        stockFile: '',
        label: 'Agendamento',
        message: ''
    }
}
```

Cada `id` deve ser único. O preço precisa ser numérico, sem `R$`. Os `aliases` são as respostas que o cliente pode digitar para escolher o produto.

### Formas de entrega

Em `products[].fulfillment.type`, escolha uma opção:

- `stock`: entrega automaticamente um item retirado do arquivo informado em `stockFile`. O arquivo fica em `data/estoque/`, com **um item por linha**. Um item pode ser um código, licença, link ou texto de acesso. Não coloque dados reais de clientes no repositório.
- `message`: envia a mensagem definida em `fulfillment.message`. Pode usar `{produto}`, `{pedido}`, `{empresa}` e `{item}` como marcadores de texto.
- `manual`: avisa o cliente que a equipe precisa concluir a entrega manualmente.

Se usar `stock`, crie, por exemplo, `data/estoque/produto-demo.txt` e coloque um item disponível em cada linha. O sistema cria o arquivo vazio se ele ainda não existir. Estoque vazio não impede a confirmação do pagamento; o pedido fica marcado para tratamento manual.

## 5. Ativar PIX e webhook NexusPag

Por padrão, pagamentos ficam desativados para o template poder iniciar sem credenciais de cobrança.

No `.env`, configure os dados reais fora do GitHub:

```env
PAYMENTS_ENABLED=true
NEXUSPAG_API_KEY=sua_chave_api
WEBHOOK_SECRET=seu_segredo_de_webhook
WEBHOOK_PUBLIC_URL=https://sua-url-publica.trycloudflare.com
WEBHOOK_PORT=3000
PIX_EXPIRATION_SECONDS=1800
```

A URL pública deve apontar para o computador que está executando o bot e encaminhar a porta local configurada. O endpoint usado pelo projeto é `/webhook/nexuspag`. Se usar um túnel temporário, a URL pode mudar quando ele for reiniciado; atualize `WEBHOOK_PUBLIC_URL` e a URL cadastrada no provedor quando necessário.

O código valida a assinatura HMAC recebida no cabeçalho `X-Webhook-Signature` e só deve processar eventos que identifique como pagamento confirmado. O reconhecimento de status fica em `lib/webhook.js`, na função `pagamentoEstaConfirmado()`. **Antes de usar em produção, compare os nomes e valores de status com a documentação e com um payload real da sua conta NexusPag.** Se o provedor usar outro formato, adapte essa função. Não desative a verificação de assinatura para “fazer funcionar”.

A integração usa o endpoint `https://nexuspag.com/api/pix/create` e o formato de requisição baseado no código de origem fornecido. O contrato da API pode mudar; confira a documentação atual da NexusPag se ocorrer erro.

## 6. Onde os dados ficam

- `data/pedidos.json`: pedidos, status do pagamento e status de entrega.
- `data/estoque/`: arquivos de estoque separados por produto.
- Pasta de autenticação local criada pelo `whatsapp-web.js`: sessão WhatsApp.
- `.env`: chaves e configurações locais.

Esses arquivos estão ignorados pelo `.gitignore`. Confira sempre `git status` antes de publicar para garantir que não esteja enviando `.env`, sessão do WhatsApp, pedidos ou estoque. Um arquivo JSON local é adequado para protótipo e baixo volume; para múltiplos processos, alto volume ou uso comercial crítico, migre pedidos e estoque para um banco de dados com transações e controle de concorrência.

## 7. Estrutura do projeto

```text
whatsapp-bot-template/
├── bot.js                 # Conexão WhatsApp e fluxo de conversas
├── config.js              # Personalização do negócio, catálogo e mensagens
├── lib/
│   ├── nexuspag.js        # Criação de cobranças PIX
│   ├── orders.js          # Leitura e gravação de pedidos
│   ├── stock.js           # Retirada de itens do estoque
│   └── webhook.js         # Servidor e validação do webhook
├── data/
│   └── estoque/           # Arquivos de estoque locais (não publicar)
├── .env.example           # Modelo de variáveis de ambiente
├── .gitignore
├── package.json
└── README.md
```

## 8. Publicar no GitHub

Crie um repositório vazio no GitHub e, no terminal dentro da pasta do projeto, execute os comandos abaixo, substituindo a URL pela do seu repositório:

```bash
git init
git add .
git status
git commit -m "Adiciona template inicial do bot WhatsApp"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Confira o resultado de `git status` antes do `git commit`. O arquivo `.env` e os dados locais não devem aparecer como arquivos a enviar.

## Observações importantes

- O fluxo de conversa fica em memória. Se o bot reiniciar no meio de uma compra, o cliente pode precisar digitar `menu` e começar novamente; pedidos já criados permanecem em `data/pedidos.json`.
- A entrega automática guarda o item reservado no pedido antes de tentar enviá-lo. Se o envio falhar, o pedido é marcado para conferência manual para evitar que o mesmo item seja entregue automaticamente a outro cliente.
- O template é um ponto de partida, não uma garantia de operação comercial sem supervisão. Teste QR Code, assinatura, status final do pagamento, estoque vazio, mensagens e recuperação após reinicialização antes de receber dinheiro real.
