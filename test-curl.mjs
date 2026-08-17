const key = "sk-fake";
const headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Authorization': `Bearer ${key}`,
  'authorization': `Bearer ${key}`,
  'x-api-key': key,
  'api-key': key,
};

fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'test' }]
  })
}).then(async res => {
  console.log(res.status);
  console.log(await res.text());
});
