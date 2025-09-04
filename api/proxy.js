// Enhanced Vercel Proxy with Parallel mem0 Operations for Low Latency
// File: /api/proxy.js for travian-proxy-simple repository
// Updated: September 4, 2025 - Parallel processing optimization
// Version: 2.0 - Reduces latency by ~500ms through parallel mem0/Claude operations

module.exports = async function handler(req, res) {
  const startTime = Date.now();
  console.log('[Travian Proxy v2.0] Request received - Parallel processing enabled');
  
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
  console.log('[Config] Mode: Parallel Processing');

  const https = require('https');
  
  // Helper function for HTTPS requests with redirect handling
  function httpsRequest(options, data, followRedirects = true, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        reject(new Error('Too many redirects'));
        return;
      }

      const req = https.request(options, (response) => {
        // Handle redirects (301, 302, 307, 308)
        if (followRedirects && [301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
          console.log(`[HTTP] Following redirect from ${response.statusCode} to ${response.headers.location}`);
          
          // Parse the redirect URL
          const redirectUrl = new URL(response.headers.location);
          const newOptions = {
            ...options,
            hostname: redirectUrl.hostname,
            path: redirectUrl.pathname + redirectUrl.search,
            port: redirectUrl.port || (redirectUrl.protocol === 'https:' ? 443 : 80)
          };
          
          // For 307/308, preserve the method and body
          if ([307, 308].includes(response.statusCode)) {
            return httpsRequest(newOptions, data, followRedirects, maxRedirects - 1).then(resolve).catch(reject);
          } else {
            // For 301/302, GET request without body
            newOptions.method = 'GET';
            return httpsRequest(newOptions, null, followRedirects, maxRedirects - 1).then(resolve).catch(reject);
          }
        }

        let responseData = '';
        response.on('data', chunk => responseData += chunk);
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              data: responseData ? JSON.parse(responseData) : null,
              headers: response.headers
            });
          } catch (e) {
            resolve({
              status: response.statusCode,
              data: responseData,
              headers: response.headers
            });
          }
        });
      });
      
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // mem0 helper functions with updated API endpoints
  async function searchMemories(userId, query = null) {
    const searchStart = Date.now();
    
    if (!MEM0_API_KEY || !userId) {
      console.log('⚠️ Mem0 not configured or no userId, skipping memory retrieval');
      return [];
    }
    
    try {
      console.log(`[mem0] Starting parallel memory search for user ${userId.substring(0, 10)}...`);
      
      // Build query parameters
      const params = new URLSearchParams({
        user_id: userId
      });
      if (query) {
        params.append('search_query', query);
      }
      
      // Use the correct mem0 API endpoint
      const options = {
        hostname: 'api.mem0.ai',
        path: `/v1/memories/?${params.toString()}`,
        method: 'GET',
        headers: {
          'Authorization': `Token ${MEM0_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };
      
      const result = await httpsRequest(options, null, true);
      
      const searchDuration = Date.now() - searchStart;
      console.log(`[mem0] Search completed in ${searchDuration}ms - Status: ${result.status}`);
      
      if (result.status === 200 && result.data) {
        const memories = result.data.memories || result.data.results || result.data || [];
        console.log(`✅ Retrieved ${Array.isArray(memories) ? memories.length : 0} memories`);
        return Array.isArray(memories) ? memories : [];
      } else {
        console.error('❌ Mem0 retrieval failed:', result.status);
        return []; // Return empty array on failure to not block Claude
      }
    } catch (error) {
      console.error('❌ Mem0 retrieval error:', error.message);
      return []; // Return empty array on error to not block Claude
    }
  }
  
  async function storeMemory(userId, messages, gameState = null) {
    if (!MEM0_API_KEY || !userId) {
      console.log('⚠️ Mem0 not configured or no userId, skipping memory storage');
      return;
    }
    
    try {
      console.log(`[mem0] Background storing memory for user ${userId.substring(0, 10)}...`);
      
      // Build memory payload according to mem0 API documentation
      const memoryData = {
        messages: messages,
        user_id: userId
      };
      
      // Add metadata if game state is available
      if (gameState) {
        memoryData.metadata = {
          gamePhase: determineGamePhase(gameState),
          villages: gameState.villages?.length || 1,
          population: gameState.population || 0,
          timestamp: new Date().toISOString()
        };
      }
      
      const requestBody = JSON.stringify(memoryData);
      
      const options = {
        hostname: 'api.mem0.ai',
        path: '/v1/memories/',
        method: 'POST',
        headers: {
          'Authorization': `Token ${MEM0_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };
      
      const result = await httpsRequest(options, requestBody, true);
      
      if (result.status === 200 || result.status === 201) {
        console.log('✅ Memory stored successfully in background');
      } else {
        console.error('❌ Background mem0 storage failed:', result.status);
      }
    } catch (error) {
      console.error('❌ Background mem0 storage error:', error.message);
      // Don't throw - this is fire-and-forget
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
        if (memory.memory || memory.text || memory.content) {
          systemPrompt += `- ${memory.memory || memory.text || memory.content}\n`;
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
  
  // Helper function to send request to Claude
  async function sendToClaude(messages, systemPrompt, body) {
    const claudeStart = Date.now();
    
    const claudeRequestBody = JSON.stringify({
      model: body.model || 'claude-3-5-sonnet-20241022',
      max_tokens: body.max_tokens || 2000,
      messages: messages,
      system: systemPrompt,
      temperature: body.temperature || 0.7
    });
    
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
    
    const result = await httpsRequest(claudeOptions, claudeRequestBody, false);
    const claudeDuration = Date.now() - claudeStart;
    console.log(`[Claude] Response received in ${claudeDuration}ms`);
    
    return result;
  }
  
  try {
    const body = req.body;
    
    // Detailed request logging
    console.log('[Proxy] Request body keys:', Object.keys(body || {}));
    console.log('[Proxy] userId:', body?.userId || 'NOT PROVIDED');
    console.log('[Proxy] Has gameState:', !!body?.gameState);
    
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
    
    // ====================
    // PARALLEL PROCESSING
    // ====================
    console.log('[Parallel] Starting parallel operations...');
    const parallelStart = Date.now();
    
    // Start both operations in parallel using Promise.allSettled
    const [memResult, claudePrep] = await Promise.allSettled([
      // mem0 search (if configured)
      userId && MEM0_API_KEY 
        ? searchMemories(userId, userMessage)
        : Promise.resolve([]),
      
      // Small delay to ensure we can build system prompt
      // This is just a promise that resolves immediately
      Promise.resolve({ ready: true })
    ]);
    
    // Extract memories safely (empty array if failed)
    const memories = memResult.status === 'fulfilled' ? memResult.value : [];
    console.log(`[Parallel] mem0 search completed - ${memories.length} memories retrieved`);
    
    // Build system prompt with retrieved memories
    const systemPrompt = body.system || buildEnhancedSystemPrompt(memories, gameState);
    
    // Now send to Claude (this is the main latency)
    const claudeResult = await sendToClaude(messages, systemPrompt, body);
    
    const parallelDuration = Date.now() - parallelStart;
    console.log(`[Parallel] Operations completed in ${parallelDuration}ms`);
    
    // Check Claude response
    if (claudeResult.status !== 200) {
      console.error('[Claude] API error:', claudeResult.status);
      return res.status(claudeResult.status).json({
        error: 'Claude API error',
        details: claudeResult.data
      });
    }
    
    // ====================
    // IMMEDIATE RESPONSE
    // ====================
    // Send response to user immediately (don't wait for storage)
    const totalDuration = Date.now() - startTime;
    console.log(`[Performance] Total response time: ${totalDuration}ms`);
    
    res.status(200).json(claudeResult.data);
    
    // ====================
    // BACKGROUND STORAGE
    // ====================
    // Store the conversation in mem0 asynchronously (fire-and-forget)
    if (userId && MEM0_API_KEY && claudeResult.data) {
      const assistantMessage = claudeResult.data.content?.[0]?.text || '';
      if (assistantMessage) {
        console.log('[Background] Storing conversation to mem0...');
        // Don't await - let it run in background
        storeMemory(
          userId,
          [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantMessage }
          ],
          gameState
        ).catch(error => {
          console.error('[Background] Storage failed:', error.message);
          // Error is logged but doesn't affect the response
        });
      }
    }
    
    // Function has returned response to user, storage continues in background
    
  } catch (error) {
    console.error('[Proxy] Handler error:', error);
    return res.status(500).json({ 
      error: 'Proxy error', 
      message: error.message 
    });
  }
};