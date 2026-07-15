module.exports = {
  apps: [
    {
      name: "desarrolloeg-monolito",
      script: "src/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "development",
        PORT: 7000
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 7000
      }
    }
  ]
};
