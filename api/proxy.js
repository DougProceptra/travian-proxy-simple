// Enhanced Vercel Proxy with mem0 Integration and Debug Logging
// File: /api/proxy.js for travian-proxy-simple repository

module.exports = async function handler(req, res) {
  console.log('[Travian Proxy] Request received - Node.js handler with mem0');
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check for API keys
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const MEM0_API_KEY = process.env.MEM0_API_KEY;
  
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not found in environment variables');
    return res.status(500).json({ error: 'Server configuration error - no Anthropic API key' });
  }

  // Log environment status
  console.log('[Config] MEM0_API_KEY:', MEM0_API_KEY ? 'Present' : 'Missing');

  const https = require('https');
  
  // Helper function for HTTPS requests
  function httpsRequest(options, data) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (response) => {
        let responseData = '';
        response.on('data', chunk => responseData += chunk);
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              data: responseData ? JSON.parse(responseData) : null
            });
          } catch (e) {
            resolve({
              status: response.statusCode,
              data: responseData
            });
          }
        });
      });
      
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // mem0 helper functions
  async function searchMemories(userId, query = null) {
    if (!MEM0_API_KEY || !userId) {
      console.log('⚠️ Mem0 not configured or no userId, skipping memory retrieval');
      console.log('[Debug] MEM0_API_KEY:', !!MEM0_API_KEY, 'userId:', userId);
      return [];
    }
    
    try {
      console.log(`[mem0] Searching memories for user ${userId.substring(0, 10)}...`);
      
      // Build query parameters
      const params = new URLSearchParams({
        user_id: userId
      });
      if (query) {
        params.append('search_query', query);
      }
      
      const options = {
        hostname: 'api.mem0.ai',
        path: `/v1/memories?${params.toString()}`,
        method: 'GET',
        headers: {
          'Authorization': `Token ${MEM0_API_KEY}`,
          'Content-Type': 'application/json'
        }
      };
      
      console.log('[mem0] Search URL:', `https://api.mem0.ai/v1/memories?${params.toString()}`);
      
      const result = await httpsRequest(options, null);
      
      console.log('[mem0] Search response status:', result.status);
      
      if (result.status === 200 && result.data) {
        const memories = result.data.memories || result.data.results || [];
        console.log(`✅ Retrieved ${memories.length} memories`);
        return memories;
      } else {
        console.error('❌ Mem0 retrieval failed:', result.status, JSON.stringify(result.data));
      }
    } catch (error) {
      console.error('❌ Mem0 retrieval error:', error.message);
    }
    return [];
  }
  
  async function storeMemory(userId, messages, gameState = null) {
    if (!MEM0_API_KEY || !userId) {
      console.log('⚠️ Mem0 not configured or no userId, skipping memory storage');
      console.log('[Debug] MEM0_API_KEY:', !!MEM0_API_KEY, 'userId:', userId);
      return;
    }
    
    try {
      console.log(`[mem0] Storing memory for user ${userId.substring(0, 10)}...`);
      
      // Build memory payload
      const memoryData = {
        messages: messages,
        user_id: userId,
        metadata: {}
      };
      
      // Add game context if available
      if (gameState) {
        memoryData.metadata = {
          gamePhase: determineGamePhase(gameState),
          villages: gameState.villages?.length || 1,
          population: gameState.population || 0,
          timestamp: new Date().toISOString()
        };
      }
      
      const requestBody = JSON.stringify(memoryData);
      
      console.log('[mem0] Store payload size:', requestBody.length, 'bytes');
      
      const options = {
        hostname: 'api.mem0.ai',
        path: '/v1/memories',
        method: 'POST',
        headers: {
          'Authorization': `Token ${MEM0_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };
      
      const result = await httpsRequest(options, requestBody);
      
      console.log('[mem0] Store response status:', result.status);
      
      if (result.status === 200 || result.status === 201) {
        console.log('✅ Memory stored successfully');
      } else {
        console.error('❌ Mem0 storage failed:', result.status, JSON.stringify(result.data));
      }
    } catch (error) {
      console.error('❌ Mem0 storage error:', error.message);
    }
  }
  
  function determineGamePhase(gameState) {
    const pop = gameState?.population || 0;
    const villages = gameState?.villages?.length || 1;
    
    if (villages === 1 && pop < 500) return 'early-game';
    if (villages < 3) return 'settling-phase';
    if (villages < 10) return 'growth-phase';
    if (villages < 20) return 'mid-game';
    return 'late-game';
  }
  
  function buildEnhancedSystemPrompt(memories, gameState) {
    let systemPrompt = `You are an expert Travian Legends strategic advisor. This is the online multiplayer game, not historical information.`;
    
    // Add memories context if available
    if (memories && memories.length > 0) {
      systemPrompt += `\n\n## Previous Context\n`;
      memories.forEach((memory, index) => {
        if (memory.memory || memory.text) {
          systemPrompt += `- ${memory.memory || memory.text}\n`;
        }
      });
    }
    
    // Add game state if available
    if (gameState) {
      systemPrompt += `\n\n## Current Game State\n`;
      systemPrompt += `- Villages: ${gameState.villages?.length || 1}\n`;
      systemPrompt += `- Population: ${gameState.population || 0}\n`;
      systemPrompt += `- Culture Points: ${gameState.culturePoints?.current || 0}/${gameState.culturePoints?.needed || 'unknown'}\n`;
      
      if (gameState.resources) {
        systemPrompt += `- Resources: Wood ${gameState.resources.wood || 0}, Clay ${gameState.resources.clay || 0}, Iron ${gameState.resources.iron || 0}, Crop ${gameState.resources.crop || 0}\n`;
      }
      
      if (gameState.production) {
        systemPrompt += `- Production: Wood ${gameState.production.wood || 0}/h, Clay ${gameState.production.clay || 0}/h, Iron ${gameState.production.iron || 0}/h, Crop ${gameState.production.crop || 0}/h\n`;
      }
      
      if (gameState.heroData) {
        systemPrompt += `- Hero Level: ${gameState.heroData.level || 0}\n`;
      }
    }
    
    systemPrompt += `\n## Instructions
1. Always consider the player's actual game state when giving advice
2. Be specific with numbers and calculations
3. Format responses with clear sections using markdown
4. Provide strategic reasoning for recommendations
5. Use bullet points and numbered lists for clarity
6. Highlight important information with **bold** text`;
    
    return systemPrompt;
  }
  
  try {
    const body = req.body;
    
    // Detailed request logging
    console.log('[Proxy] Request body keys:', Object.keys(body || {}));
    console.log('[Proxy] userId:', body?.userId || 'NOT PROVIDED');
    console.log('[Proxy] Has gameState:', !!body?.gameState);
    console.log('[Proxy] Has messages:', !!body?.messages);
    console.log('[Proxy] Has message:', !!body?.message);
    
    if (!body) {
      return res.status(400).json({ error: 'Invalid request - no body' });
    }
    
    // Extract userId and gameState if provided
    const userId = body.userId || null;
    const gameState = body.gameState || null;
    
    // Handle both new format (with userId/gameState) and old format (with messages array)
    let messages = body.messages;
    let userMessage = '';
    
    if (!messages) {
      // New format - build messages from single message
      if (body.message) {
        userMessage = body.message;
        messages = [{ role: 'user', content: userMessage }];
      } else {
        return res.status(400).json({ error: 'Invalid request - missing messages or message' });
      }
    } else {
      // Old format - extract last user message
      userMessage = messages[messages.length - 1]?.content || '';
    }
    
    // Search mem0 for relevant memories if userId provided
    let memories = [];
    if (userId && MEM0_API_KEY) {
      console.log(`[mem0] Processing request for user: ${userId.substring(0, 10)}...`);
      memories = await searchMemories(userId, userMessage);
    } else {
      console.log('[mem0] Skipping - userId:', userId, 'MEM0_API_KEY:', !!MEM0_API_KEY);
    }
    
    // Build enhanced system prompt with memories and game context
    const systemPrompt = body.system || buildEnhancedSystemPrompt(memories, gameState);
    
    // Prepare Claude request
    const claudeRequestBody = JSON.stringify({
      model: body.model || 'claude-3-5-sonnet-20241022',
      max_tokens: body.max_tokens || 2000,
      messages: messages,
      system: systemPrompt,
      temperature: body.temperature || 0.7
    });
    
    console.log('[Claude] Sending request with', memories.length, 'memories in context');
    
    // Call Claude API
    const claudeOptions = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(claudeRequestBody),
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    };
    
    const claudeResult = await httpsRequest(claudeOptions, claudeRequestBody);
    
    if (claudeResult.status !== 200) {
      console.error('[Claude] API error:', claudeResult.status, claudeResult.data);
      return res.status(claudeResult.status).json({
        error: 'Claude API error',
        details: claudeResult.data
      });
    }
    
    // Store the conversation in mem0 if userId provided
    if (userId && MEM0_API_KEY && claudeResult.data) {
      const assistantMessage = claudeResult.data.content?.[0]?.text || '';
      if (assistantMessage) {
        console.log('[mem0] Attempting to store conversation...');
        await storeMemory(
          userId,
          [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantMessage }
          ],
          gameState
        );
      }
    } else {
      console.log('[mem0] Not storing - userId:', userId, 'MEM0_API_KEY:', !!MEM0_API_KEY, 'has response:', !!claudeResult.data);
    }
    
    // Return Claude's response
    return res.status(200).json(claudeResult.data);
    
  } catch (error) {
    console.error('[Proxy] Handler error:', error);
    return res.status(500).json({ 
      error: 'Proxy error', 
      message: error.message 
    });
  }
};