const key = "test"; // doesn't matter, just seeing what the server returns
fetch('https://api.avalai.ir/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  },
  body: JSON.stringify({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'test' }]
  })
}).then(async res => {
  console.log(res.status);
  console.log(await res.text());
});
