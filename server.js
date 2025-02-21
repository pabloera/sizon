// API de Controle para Middleware Zotero-Notion
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Importa as funções do middleware (ajuste o caminho se necessário)
const { 
  processZoteroItem, 
  batchProcessZoteroItems, 
  startMonitoring, 
  stopMonitoring, 
  getStatus 
} = require('./index.js');

// Importa o processador acadêmico
const { processAcademicPaper } = require('./academic-summarizer');

// Configuração do servidor Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Rotas de API
app.get('/status', (req, res) => {
  const status = getStatus();
  res.json({
    status: 'online',
    isMonitoringActive: status.isMonitoringActive,
    lastUpdated: status.lastUpdated
  });
});

// Iniciar monitoramento
app.post('/start', async (req, res) => {
  const status = getStatus();
  if (status.isMonitoringActive) {
    return res.json({ message: 'Monitoramento já está ativo', status: 'unchanged' });
  }

  try {
    const result = await startMonitoring();
    
    if (result) {
      console.log("Monitoramento iniciado com sucesso");
      return res.json({ message: 'Monitoramento iniciado com sucesso', status: 'started' });
    } else {
      return res.status(500).json({ message: 'Falha ao iniciar monitoramento', status: 'error' });
    }
  } catch (error) {
    console.error("Erro ao iniciar monitoramento:", error);
    return res.status(500).json({ message: 'Erro ao iniciar monitoramento', error: error.message });
  }
});

// Parar monitoramento
app.post('/stop', (req, res) => {
  const status = getStatus();
  if (!status.isMonitoringActive) {
    return res.json({ message: 'Monitoramento já está inativo', status: 'unchanged' });
  }

  try {
    const result = stopMonitoring();
    
    if (result) {
      console.log("Monitoramento interrompido com sucesso");
      return res.json({ message: 'Monitoramento interrompido com sucesso', status: 'stopped' });
    } else {
      return res.status(500).json({ message: 'Falha ao interromper monitoramento', status: 'error' });
    }
  } catch (error) {
    console.error("Erro ao interromper monitoramento:", error);
    return res.status(500).json({ message: 'Erro ao interromper monitoramento', error: error.message });
  }
});

// Processar itens sob demanda
app.post('/process', async (req, res) => {
  const { limit = 5 } = req.body;
  
  try {
    console.log(`Iniciando processamento manual de ${limit} itens`);
    await batchProcessZoteroItems(limit);
    return res.json({ message: `Processamento de ${limit} itens concluído`, status: 'success' });
  } catch (error) {
    console.error("Erro ao processar itens:", error);
    return res.status(500).json({ message: 'Erro ao processar itens', error: error.message });
  }
});

// Servir a página de controle
app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'control.html'));
});

// Rota principal com documentação
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>API de Controle Zotero-Notion</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          h2 { color: #555; margin-top: 20px; }
          pre { background: #f5f5f5; padding: 10px; border-radius: 5px; }
          .endpoint { background: #e9f7fd; padding: 10px; border-radius: 5px; margin-bottom: 10px; }
          .method { font-weight: bold; color: #0066cc; }
        </style>
      </head>
      <body>
        <h1>API de Controle Zotero-Notion</h1>
        <p>Use esta API para controlar o middleware de integração entre Zotero e Notion.</p>
        
        <h2>Endpoints Disponíveis:</h2>
        
        <div class="endpoint">
          <p><span class="method">GET</span> /status</p>
          <p>Verifica o status atual do serviço.</p>
        </div>
        
        <div class="endpoint">
          <p><span class="method">POST</span> /start</p>
          <p>Inicia o monitoramento automático do Zotero.</p>
        </div>
        
        <div class="endpoint">
          <p><span class="method">POST</span> /stop</p>
          <p>Interrompe o monitoramento automático.</p>
        </div>
        
        <div class="endpoint">
          <p><span class="method">POST</span> /process</p>
          <p>Processa manualmente um número específico de itens.</p>
          <pre>Corpo: { "limit": 5 }</pre>
        </div>

        <div class="endpoint">
          <p><span class="method">GET</span> /control</p>
          <p>Acessa a página de controle visual.</p>
        </div>
      </body>
    </html>
  `);
});

// Processar sumarização acadêmica para um item específico
app.post('/summarize', async (req, res) => {
  const { itemKey } = req.body;
  
  if (!itemKey) {
    return res.status(400).json({ 
      message: 'Chave do item (itemKey) é obrigatória', 
      status: 'error' 
    });
  }
  
  try {
    console.log(`Iniciando sumarização acadêmica para o item ${itemKey}`);
    const summary = await processAcademicPaper(itemKey);
    
    if (summary) {
      return res.json({ 
        message: 'Sumarização acadêmica concluída com sucesso', 
        status: 'success',
        summary: summary 
      });
    } else {
      return res.status(500).json({ 
        message: 'Falha ao realizar sumarização acadêmica', 
        status: 'error' 
      });
    }
  } catch (error) {
    console.error("Erro ao realizar sumarização acadêmica:", error);
    return res.status(500).json({ 
      message: 'Erro ao realizar sumarização acadêmica', 
      error: error.message,
      status: 'error'
    });
  }
});

// Processar sumarização acadêmica em lote (últimos N itens)
app.post('/summarize-batch', async (req, res) => {
  const { limit = 5 } = req.body;
  
  try {
    // Busca os itens mais recentes do Zotero
    const items = await fetchRecentZoteroItems(limit);
    
    if (!items || items.length === 0) {
      return res.status(404).json({ 
        message: 'Nenhum item encontrado para sumarizar', 
        status: 'error' 
      });
    }
    
    console.log(`Iniciando sumarização em lote para ${items.length} itens`);
    
    // Inicia o processamento em background
    res.json({ 
      message: `Processamento de ${items.length} itens iniciado em segundo plano`, 
      status: 'processing',
      itemCount: items.length
    });
    
    // Processa cada item (após enviar a resposta)
    for (const item of items) {
      if (item.data.itemType !== 'attachment') {
        console.log(`Processando sumarização acadêmica para ${item.key}...`);
        await processAcademicPaper(item.key);
      }
    }
    
    console.log("Processamento em lote de sumarização concluído");
    
  } catch (error) {
    console.error("Erro ao processar sumarização em lote:", error);
  }
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`API de controle disponível em http://localhost:${PORT}`);
  console.log(`Interface de controle disponível em http://localhost:${PORT}/control`);
});
