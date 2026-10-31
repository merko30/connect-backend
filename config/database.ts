export default ({ env }) => {
  const client = env("DATABASE_CLIENT", "postgres");

  const connections = {
    postgres: {
      connection: {
        host: env("DATABASE_HOST"),
        port: env.int("DATABASE_PORT", 5432),
        database: env("DATABASE_NAME"),
        user: env("DATABASE_USERNAME"),
        password: env("DATABASE_PASSWORD"),
        ssl: false,
        schema: env("DATABASE_SCHEMA", "public"),
      },
      pool: {
        min: 0,
        max: 10,
      },
    },
  };

  return {
    connection: {
      client,
      ...connections[client],
      acquireConnectionTimeout: env.int("DATABASE_CONNECTION_TIMEOUT", 60000),
    },
  };
};
