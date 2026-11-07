// Re-embed the SQL migrations whenever a file in migrations/ changes.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
