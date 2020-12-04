const { app } = require('./auth.js');
const { redis_client, restart_app } = require('./bot.js');

const port = process.env.PORT || 5000;
app.listen(port,
    () => console.log(`Auth server is running at port ${port}...`));

restart_app();