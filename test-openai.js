const { OpenAICompatibleProvider } = require('./packages/llm/dist/index.js');
const provider = new OpenAICompatibleProvider({
  providerId: 'test.openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY || 'sk-test',
  models: [{ id: 'gpt-4o-mini', tier: 'smart' }]
});

provider.complete({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'test' }],
  maxTokens: 5
}).then(console.log).catch(console.error);
