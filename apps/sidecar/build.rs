use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let mut type_space = typify::TypeSpace::default();
    
    let schema_dir = PathBuf::from("../../packages/schema-definitions/schemas");
    
    // Read and parse schemas
    let schemas = ["AlertRule.json", "NormalizedTicker.json", "SidecarConfigPayload.json", "SystemConfig.json"];

    
    for schema_file in schemas {
        let schema_str = fs::read_to_string(schema_dir.join(schema_file)).unwrap();
        let schema: schemars::schema::RootSchema = serde_json::from_str(&schema_str).unwrap();
        type_space.add_root_schema(schema).unwrap();
    }
    
    let code = type_space.to_stream().to_string();
    
    let out_dir = env::var("OUT_DIR").unwrap();
    let dest_path = PathBuf::from(out_dir).join("generated.rs");
    fs::write(&dest_path, code).unwrap();
    
    println!("cargo:rerun-if-changed=../../packages/schema-definitions/schemas");
}
