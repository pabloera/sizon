# Integração Zotero-Notion-LLM

## Introdução

Este projeto implementa um middleware de integração entre Zotero (gestor de referências bibliográficas), Notion (plataforma de organização de conhecimento) e modelos de linguagem de grande escala (LLM). O sistema automatiza o fluxo de trabalho acadêmico, extraindo metadados e conteúdo de artigos científicos armazenados no Zotero, enriquecendo-os com processamento de linguagem natural e integrando os resultados ao Notion para fácil acesso e consulta.

### Objetivo

O objetivo principal é criar uma ponte automatizada entre o Zotero e o Notion, potencializada por capacidades avançadas de processamento de linguagem natural, para:

1. Sincronizar referências bibliográficas do Zotero para o Notion automaticamente
2. Extrair e melhorar metadados dos documentos acadêmicos
3. Gerar resumos, análises críticas e pontos-chave de artigos científicos
4. Fornecer uma interface de controle para gerenciar o processo
5. Permitir a sumarização acadêmica avançada e rigorosa de documentos completos

## Tabela de Conteúdo

- [Instalação](#instalação)
- [Configuração](#configuração)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Funcionalidades](#funcionalidades)
- [API de Controle](#api-de-controle)
- [Interface Web](#interface-web)
- [Sumarização Acadêmica](#sumarização-acadêmica)
- [Monitoramento Contínuo](#monitoramento-contínuo)
- [Execução em Segundo Plano](#execução-em-segundo-plano)
- [Troubleshooting](#troubleshooting)
- [Integração com Notero](#integração-com-notero)
- [Próximos Passos](#próximos-passos)

## Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/zotero-notion-llm.git
cd zotero-notion-llm

# Instale as dependências
npm install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```
ZOTERO_API_KEY=sua_chave_api_zotero
ZOTERO_USER_ID=seu_id_usuario_zotero
NOTION_API_KEY=sua_chave_api_notion
NOTION_DATABASE_ID=id_do_banco_notion
OPENAI_API_KEY=sua_chave_api_openai
```

## Estrutura do Projeto

```
zotero-notion-llm/
├── index.js                # Middleware principal
├── server.js               # Servidor de API de controle
├── pdf-locator.js          # Localização de PDFs no armazenamento do Zotero
├── academic-summarizer.js  # Sumarização acadêmica avançada
├── control.html            # Interface de controle web
├── temp/                   # Diretório de arquivos temporários
├── package.json            # Dependências do projeto
└── .env                    # Configurações de ambiente
```

## Funcionalidades

### Sincronização Zotero-Notion

- Extração automática de metadados de itens do Zotero
- Identificação e processamento de PDFs anexados 
- Criação e atualização de registros correspondentes no Notion
- Compatibilidade com o plugin Notero

### Processamento com LLM

- Extração de metadados usando IA quando os dados bibliográficos são incompletos
- Geração de resumos automatizados
- Identificação de pontos-chave e conclusões
- Análise de metodologia e contribuições

### Sumarização Acadêmica Avançada

- Processamento completo de PDFs armazenados localmente
- Análise detalhada do documento em chunks gerenciáveis
- Síntese abrangente com estrutura acadêmica rigorosa
- Atualização dos registros do Notion com resumos detalhados

### Controle e Monitoramento

- API REST para controle do middleware
- Interface web para gerenciamento do sistema
- Monitoramento contínuo de novos itens no Zotero
- Processamento em lote sob demanda

## API de Controle

O middleware expõe uma API REST para controle:

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/status` | GET | Verifica o status do serviço |
| `/start` | POST | Inicia o monitoramento automático |
| `/stop` | POST | Interrompe o monitoramento |
| `/process` | POST | Processa manualmente N itens |
| `/summarize` | POST | Sumarização acadêmica de um item específico |
| `/summarize-batch` | POST | Sumarização acadêmica em lote |
| `/control` | GET | Acessa a interface de controle web |

## Interface Web

A interface de controle oferece:
- Indicadores visuais de status do sistema
- Botões para iniciar/parar monitoramento
- Processamento manual de itens em lote
- Sumarização acadêmica avançada
- Log de atividades recentes

## Sumarização Acadêmica

A sumarização acadêmica avançada gera um documento estruturado contendo:

1. Resumo geral
2. Problema de pesquisa
3. Metodologia
4. Resultados principais
5. Argumentação teórica
6. Contribuições para o campo
7. Limitações
8. Conexões com a literatura
9. Implicações
10. Análise crítica

Este documento é então integrado à página do Notion correspondente ao artigo.

## Monitoramento Contínuo

O sistema pode monitorar continuamente o Zotero em busca de novos itens:

```bash
# Inicie o servidor e o monitoramento
node server.js
```

Acesse `http://localhost:3000/control` para gerenciar o sistema.

## Execução em Segundo Plano

Para executar o middleware em segundo plano:

```bash
# Instale o PM2 globalmente
npm install -g pm2

# Inicie o servidor usando PM2
pm2 start server.js --name "zotero-notion-middleware"

# Verifique o status
pm2 status

# Visualize logs
pm2 logs zotero-notion-middleware
```

## Troubleshooting

### Problemas comuns

- **Erro de autenticação da API**: Verifique as chaves de API no arquivo `.env`
- **PDFs não encontrados**: Confirme o caminho de armazenamento do Zotero em `pdf-locator.js`
- **Erros 404 ao buscar PDFs**: Comum para itens sem PDF anexado, não é um erro crítico

## Integração com Notero

Este middleware trabalha em harmonia com o plugin Notero para Zotero:

- Detecta e respeita links criados pelo Notero
- Complementa a funcionalidade manual do Notero com automação
- Evita duplicação de dados entre os sistemas

## Próximos Passos

- Implementação de autenticação na API de controle
- Expansão para outras plataformas além do Notion
- Vetorização de documentos para busca semântica
- Relatórios e estatísticas sobre itens processados
- Migração para uma solução baseada em nuvem
