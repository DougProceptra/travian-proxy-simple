// Travian Proxy with Mem0 Integration
const https = require('https');

// Helper function to make HTTPS requests
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Determine game phase for mem0 metadata
function determineGamePhase(gameState) {
  const villages = gameState?.villages?.length || 1;
  const cpHours = gameState?.culturePoints?.hoursRemaining;
  
  if (villages === 1 && cpHours && cpHours < 48) return 'settlement_rush';
  if (villages < 3) return 'early_expansion';
  if (villages < 10) return 'mid_game_growth';
  if (villages >= 10) return 'late_game';
  return 'unknown_phase';
}

module.exports = async function handler(req, res) {
  console.log('Travian Proxy with Mem0 - Node.js handler');
  
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
    console.error('ANTHROPIC_API_KEY not found');
    return res.status(500).json({ error: 'Server configuration error - no Anthropic API key' });
  }

  try {
    const body = req.body;
    
    // Check if this is a mem0-enhanced request (has userId and gameState)
    if (body.userId && body.gameState) {
      console.log(`Processing mem0-enhanced request for user ${body.userId.substring(0, 10)}...`);
      
      let relevantMemories = [];
      
      // Only use mem0 if API key is configured
      if (mem0Key) {
        try {
          // Search for relevant memories for this user
          const mem0SearchBody = JSON.stringify({
            query: body.message || body.messages?.[0]?.content || '',
            user_id: body.userId,
            limit: 5
          });

          const mem0SearchOptions = {
            hostname: 'api.mem0.ai',
            path: '/v1/memories/search/',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Token ${mem0Key}`,
              'Content-Length': Buffer.byteLength(mem0SearchBody)
            }
          };

          const searchResult = await httpsRequest(mem0SearchOptions, mem0SearchBody);
          
          if (searchResult.status === 200 && searchResult.data.results) {
            relevantMemories = searchResult.data.results;
            console.log(`Found ${relevantMemories.length} relevant memories`);
          }
        } catch (mem0Error) {
          console.error('Mem0 search error:', mem0Error);
          // Continue without memories if mem0 fails
        }
      }
      
      // Build enhanced system prompt with game context and memories
      const systemPrompt = `You are an expert Travian Legends strategic advisor with access to the player's current game state and history.

## CURRENT GAME STATE
Resources: Wood ${body.gameState.resources?.wood || 0}, Clay ${body.gameState.resources?.clay || 0}, Iron ${body.gameState.resources?.iron || 0}, Crop ${body.gameState.resources?.crop || 0}
Production: Wood ${body.gameState.production?.wood || 0}/h, Clay ${body.gameState.production?.clay || 0}/h, Iron ${body.gameState.production?.iron || 0}/h, Crop ${body.gameState.production?.crop || 0}/h
Culture Points: ${body.gameState.culturePoints?.current || 0}/${body.gameState.culturePoints?.needed || '?'} (${body.gameState.culturePoints?.hoursRemaining || '?'}h to settlement)
Hero: Level ${body.gameState.heroData?.level || '?'}, Resource Production: ${JSON.stringify(body.gameState.heroData?.resourceProduction || {})}
Villages: ${body.gameState.villages?.length || 1}
Population: ${body.gameState.population || 0}
Tribe: ${body.gameState.tribe || 'Unknown'}
Server: ${body.gameState.serverSpeed || 1}x speed

${relevantMemories.length > 0 ? '## YOUR PAST PATTERNS & STRATEGIES\n' + relevantMemories.map(m => `- ${m.memory} (relevance: ${m.score?.toFixed(2) || 'N/A'})`).join('\n') : ''}

${body.gameMechanics ? '## GAME MECHANICS DATA\n' + JSON.stringify(body.gameMechanics, null, 2) : ''}

## INSTRUCTIONS
- Provide specific, actionable advice based on the current game state
- Use actual numbers from the game data in your recommendations
- Reference past patterns and what has worked for this player before
- Focus on Travian Legends mechanics (not Kingdoms or other versions)
- For this ${body.gameState.serverSpeed || 1}x server, adjust all timing recommendations accordingly`;

      // Prepare messages for Claude
      const messages = body.messages || [{ role: 'user', content: body.message }];
      
      // Call Claude with enhanced context
      const anthropicBody = JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 2000,
        messages: messages,
        system: systemPrompt,
        temperature: body.temperature || 0.7
      });

      const anthropicOptions = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(anthropicBody),
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        }
      };

      const claudeResult = await httpsRequest(anthropicOptions, anthropicBody);
      
      // Store conversation in mem0 if successful and API key exists
      if (mem0Key && claudeResult.status === 200 && claudeResult.data.content) {
        try {
          const mem0AddBody = JSON.stringify({
            messages: [
              {
                role: 'user',
                content: body.message || messages[messages.length - 1].content
              },
              {
                role: 'assistant',
                content: claudeResult.data.content[0].text
              }
            ],
            user_id: body.userId,
            metadata: {
              game_phase: determineGamePhase(body.gameState),
              villages: body.gameState.villages?.length || 1,
              culture_points: body.gameState.culturePoints?.current || 0,
              timestamp: new Date().toISOString()
            }
          });

          const mem0AddOptions = {
            hostname: 'api.mem0.ai',
            path: '/v1/memories/',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Token ${mem0Key}`,
              'Content-Length': Buffer.byteLength(mem0AddBody)
            }
          };

          await httpsRequest(mem0AddOptions, mem0AddBody);
          console.log(`Stored memory for user ${body.userId.substring(0, 10)}...`);
        } catch (mem0StoreError) {
          console.error('Mem0 store error:', mem0StoreError);
          // Don't fail the request if mem0 storage fails
        }
      }
      
      // Return Claude's response
      return res.status(claudeResult.status).json(claudeResult.data);
      
    } else {
      // Fallback to simple proxy mode for backwards compatibility
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
