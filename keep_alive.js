const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Server is running fine ✅'));
app.listen(process.env.PORT || 3000, () =>
  console.log('Keep-alive server active.')
);