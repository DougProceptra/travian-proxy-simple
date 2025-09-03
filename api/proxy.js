// Enhanced Vercel Proxy with mem0 Integration and Better System Prompts
module.exports = async function handler(req, res) {
  console.log('Travian Proxy with mem0 - Node.js handler');
  
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const mem0Key = process.env.MEM0_API_KEY;
  
  if (!anthropicKey) {
    console.error('ANTHROPIC_API_KEY not found in environment variables');
    return res.status(500).json({ error: 'Server configuration error - no Anthropic API key' });
  }

  const https = require('https');
  
  // Helper function for HTTPS requests
  function httpsRequest(options, data) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              data: responseData ? JSON.parse(responseData) : {}
            });
          } catch (e) {
            resolve({ status: res.statusCode, data: responseData });
          }
        });
      });
      
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  try {
    const body = req.body;
    
    // Check if this is a mem0-enhanced request
    if (body.userId && body.gameState && mem0Key) {
      console.log('Processing mem0-enhanced request for user:', body.userId);
      
      // 1. Search mem0 for relevant memories
      let memories = [];
      try {
        const mem0SearchOptions = {
          hostname: 'api.mem0.ai',
          path: `/v1/memories?user_id=${body.userId}&limit=10`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${mem0Key}`,
            'Content-Type': 'application/json'
          }
        };
        
        const mem0Result = await httpsRequest(mem0SearchOptions);
        if (mem0Result.status === 200 && mem0Result.data.results) {
          memories = mem0Result.data.results;
          console.log(`Found ${memories.length} memories for user`);
        }
      } catch (error) {
        console.error('Mem0 search error:', error);
        // Continue without memories
      }
      
      // 2. Build enhanced system prompt with game context and memories
      const systemPrompt = body.system || buildEnhancedSystemPrompt(body.gameState, memories);
      
      // 3. Build messages array with context
      const messages = [];
      
      // Add user message with game context
      const contextualizedMessage = buildContextualMessage(body.message, body.gameState);
      messages.push({ role: 'user', content: contextualizedMessage });
      
      // 4. Send to Claude with enhanced prompt
      const requestBody = JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 2000,
        system: systemPrompt,
        messages: messages,
        temperature: body.temperature || 0.7
      });

      const claudeOptions = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        }
      };

      const claudeResult = await httpsRequest(claudeOptions, requestBody);
      
      if (claudeResult.status !== 200) {
        console.error('Claude API error:', claudeResult.data);
        return res.status(claudeResult.status).json(claudeResult.data);
      }
      
      // 5. Store conversation in mem0
      if (mem0Key && claudeResult.data.content && claudeResult.data.content[0]) {
        try {
          const memoryContent = {
            user_message: body.message,
            ai_response: claudeResult.data.content[0].text,
            game_state_summary: summarizeGameState(body.gameState),
            timestamp: new Date().toISOString()
          };
          
          const mem0StoreOptions = {
            hostname: 'api.mem0.ai',
            path: '/v1/memories',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${mem0Key}`,
              'Content-Type': 'application/json'
            }
          };
          
          const mem0Data = JSON.stringify({
            messages: [
              { role: 'user', content: body.message },
              { role: 'assistant', content: claudeResult.data.content[0].text }
            ],
            user_id: body.userId,
            metadata: {
              game_state: summarizeGameState(body.gameState),
              conversation_id: body.conversationId
            }
          });
          
          await httpsRequest(mem0StoreOptions, mem0Data);
          console.log('Stored conversation in mem0');
        } catch (error) {
          console.error('Mem0 store error:', error);
          // Continue without storing
        }
      }
      
      return res.status(200).json(claudeResult.data);
      
    } else {
      // Regular proxy request without mem0
      console.log('Processing simple proxy request (no mem0)');
      
      if (!body || !body.messages) {
        return res.status(400).json({ error: 'Invalid request - missing messages' });
      }
      
      const requestBody = JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 1000,
        messages: body.messages,
        system: body.system,
        temperature: body.temperature || 0.7
      });

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        }
      };

      const result = await httpsRequest(options, requestBody);
      return res.status(result.status).json(result.data);
    }
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Handler error', 
      message: error.message 
    });
  }
};

// Helper functions
function buildEnhancedSystemPrompt(gameState, memories) {
  const hero = gameState.heroData || {};
  
  let prompt = `You are an expert Travian Legends strategic advisor with deep game knowledge.

## GAME CONTEXT
- Server: ${gameState.serverSpeed || 2}x speed
- Tribe: ${gameState.tribe || 'Unknown'}
- Villages: ${gameState.villages?.length || 1}
- Population: ${gameState.population || 0}

## RESOURCES
- Current: Wood ${gameState.resources?.wood || 0}, Clay ${gameState.resources?.clay || 0}, Iron ${gameState.resources?.iron || 0}, Crop ${gameState.resources?.crop || 0}
- Production: Wood ${gameState.production?.wood || 0}/h, Clay ${gameState.production?.clay || 0}/h, Iron ${gameState.production?.iron || 0}/h, Crop ${gameState.production?.crop || 0}/h

## CULTURE POINTS
- Current/Needed: ${gameState.culturePoints?.current || 0}/${gameState.culturePoints?.needed || 'unknown'}
- Daily Production: ${gameState.culturePoints?.totalPerDay || 0}
- Time to Settlement: ${gameState.culturePoints?.hoursRemaining || 'unknown'} hours

## HERO STATUS
- Level: ${hero.level || 'unknown'}
- Health: ${hero.health || 'unknown'}%
- Attack Power: ${hero.attack || 'unknown'}
- Defense Power: ${hero.defense || 'unknown'}
- Fighting Strength: ${hero.fightingStrength || 'unknown'}
- Resource Production: ${hero.resourceProduction ? JSON.stringify(hero.resourceProduction) : 'unknown'}`;

  // Add memories if available
  if (memories && memories.length > 0) {
    prompt += '\n\n## PLAYER HISTORY & PATTERNS\n';
    memories.slice(0, 5).forEach(memory => {
      if (memory.memory) {
        prompt += `- ${memory.memory}\n`;
      }
    });
  }

  prompt += `

## RESPONSE GUIDELINES
1. Always consider the player's actual game state when giving advice
2. Be specific with numbers and calculations based on their resources
3. Format responses with clear sections using markdown headers (##, ###)
4. For combat questions, calculate exact outcomes based on Travian Legends mechanics
5. Use bullet points and numbered lists for clarity
6. Highlight important information with **bold** text
7. For oasis attacks, consider hero equipment and whether hero is mounted
8. Provide strategic reasoning for all recommendations

Remember: This is Travian Legends (the online game), not historical information.`;

  return prompt;
}

function buildContextualMessage(userMessage, gameState) {
  return `[Current Game State: ${gameState.serverSpeed}x server, ${gameState.villages?.length || 1} villages, Population ${gameState.population}, Resources: ${gameState.resources?.wood}/${gameState.resources?.clay}/${gameState.resources?.iron}/${gameState.resources?.crop}]

${userMessage}`;
}

function summarizeGameState(gameState) {
  return {
    villages: gameState.villages?.length || 1,
    population: gameState.population || 0,
    resources: gameState.resources || {},
    production: gameState.production || {},
    culturePoints: gameState.culturePoints?.current || 0,
    heroLevel: gameState.heroData?.level || 0
  };
}