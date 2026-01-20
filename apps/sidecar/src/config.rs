use std::env;

pub struct Config {
    pub port: u16,
    pub jwt_secret: String,
}

impl Config {
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "3001".to_string())
            .parse()
            .expect("PORT must be a number");
        let jwt_secret = env::var("JWT_SECRET")
            .expect("JWT_SECRET must be set");
        
        Config { port, jwt_secret }
    }
}
