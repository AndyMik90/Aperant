/**
 * Mock implementation for infrastructure and system operations
 * Updated for LadybugDB (embedded database, no Docker required)
 */

export const infrastructureMock = {
  // Memory Infrastructure Operations (LadybugDB)
  getMemoryInfrastructureStatus: async () => ({
    success: true,
    data: {
      memory: {
        kuzuInstalled: true,
        databasePath: '~/.auto-claude/graphs',
        databaseExists: true,
        databases: ['auto_claude_memory']
      },
      ready: true
    }
  }),

  listMemoryDatabases: async () => ({
    success: true,
    data: ['auto_claude_memory', 'project_memory']
  }),

  testMemoryConnection: async () => ({
    success: true,
    data: {
      success: true,
      message: 'Connected to LadybugDB database (mock)',
      details: { latencyMs: 5 }
    }
  }),

  // Ollama Model Detection Operations
  checkOllamaStatus: async () => ({
    success: true,
    data: {
      running: true,
      url: 'http://localhost:11434',
      version: '0.1.0',
    }
  }),

  checkOllamaInstalled: async () => ({
    success: true,
    data: {
      installed: true,
      path: '/usr/local/bin/ollama',
      version: '0.1.0',
    }
  }),

  installOllama: async () => ({
    success: true,
    data: {
      command: 'curl -fsSL https://ollama.com/install.sh | sh',
    }
  }),

  listOllamaModels: async () => ({
    success: true,
    data: {
      models: [
        { name: 'llama2', size_bytes: 4000000000, size_gb: 3.73, modified_at: '2024-01-01', is_embedding: false },
        { name: 'nomic-embed-text', size_bytes: 500000000, size_gb: 0.47, modified_at: '2024-01-01', is_embedding: true, embedding_dim: 768, description: 'Nomic AI text embeddings' },
      ],
      count: 2
    }
  }),

   listOllamaEmbeddingModels: async () => ({
     success: true,
     data: {
       embedding_models: [
         { name: 'embeddinggemma', embedding_dim: 768, description: "Google's lightweight embedding model (Recommended)", size_bytes: 650000000, size_gb: 0.621 },
         { name: 'nomic-embed-text', embedding_dim: 768, description: 'Popular general-purpose embeddings', size_bytes: 287000000, size_gb: 0.274 },
         { name: 'mxbai-embed-large', embedding_dim: 1024, description: 'MixedBread AI large embeddings', size_bytes: 701000000, size_gb: 0.670 },
       ],
       count: 3
     }
   }),

   pullOllamaModel: async (modelName: string) => ({
     success: true,
     data: {
       model: modelName,
       status: 'completed' as const,
       output: [`Pulling ${modelName}...`, 'Pull complete']
     }
   }),

   onDownloadProgress: (callback: (data: {
     modelName: string;
     status: string;
     completed: number;
     total: number;
     percentage: number;
   }) => void) => {
     // Store callback for test verification
     (window as any).__downloadProgressCallback = callback;

     // Return cleanup function
     return () => {
       delete (window as any).__downloadProgressCallback;
     };
   },

  // Ideation Operations
  getIdeation: async () => ({
    success: true,
    data: null
  }),

  generateIdeation: () => {
    console.warn('[Browser Mock] generateIdeation called');
  },

  refreshIdeation: () => {
    console.warn('[Browser Mock] refreshIdeation called');
  },

  stopIdeation: async () => ({ success: true }),

  updateIdeaStatus: async () => ({ success: true }),

  convertIdeaToTask: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  dismissIdea: async () => ({ success: true }),

  dismissAllIdeas: async () => ({ success: true }),

  archiveIdea: async () => ({ success: true }),

  deleteIdea: async () => ({ success: true }),

  deleteMultipleIdeas: async () => ({ success: true }),

  onIdeationProgress: () => () => {},
  onIdeationLog: () => () => {},
  onIdeationComplete: () => () => {},
  onIdeationError: () => () => {},
  onIdeationStopped: () => () => {},
  onIdeationTypeComplete: () => () => {},
  onIdeationTypeFailed: () => () => {},

  // Shell Operations
  openExternal: async (url: string) => {
    console.warn('[Browser Mock] openExternal:', url);
    window.open(url, '_blank');
  },

  openTerminal: async (dirPath: string) => {
    console.warn('[Browser Mock] openTerminal:', dirPath);
    return { success: true };
  }
};
