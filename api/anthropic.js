// Simple Node.js proxy for Anthropic API
// Force rebuild: 1
const https = require('https');

export default async function handler(req, res) {
  console.log('New version running - Node.js native');
  
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

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not found in environment variables');
    return res.status(500).json({ error: 'Server configuration error - no API key' });
  }

  try {
    // Prepare the request body
    const requestBody = JSON.stringify({
      model: req.body.model || 'claude-3-5-sonnet-20241022',
      max_tokens: req.body.max_tokens || 1000,
      messages: req.body.messages,
      temperature: req.body.temperature || 0.7,
    });

    // Make request to Anthropic
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    };

    const anthropicReq = https.request(options, (anthropicRes) => {
      let data = '';
      
      anthropicRes.on('data', (chunk) => {
        data += chunk;
      });
      
      anthropicRes.on('end', () => {
        try {
          const responseData = JSON.parse(data);
          res.status(anthropicRes.statusCode).json(responseData);
        } catch (parseError) {
          res.status(500).json({ error: 'Failed to parse Anthropic response' });
        }
      });
    });

    anthropicReq.on('error', (error) => {
      console.error('Request error:', error);
      res.status(500).json({ error: 'Failed to connect to Anthropic API' });
    });

    anthropicReq.write(requestBody);
    anthropicReq.end();
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Handler error', 
      message: error.message 
    });
  }
}
