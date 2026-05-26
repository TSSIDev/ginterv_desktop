use anyhow::Result;
use keyring::Entry;

const SERVICE: &str = "gestoreinterventi";

pub fn store_password(email: &str, password: &str) -> Result<()> {
    Entry::new(SERVICE, email)?.set_password(password)?;
    Ok(())
}

pub fn load_password(email: &str) -> Result<String> {
    Ok(Entry::new(SERVICE, email)?.get_password()?)
}

pub fn delete_password(email: &str) -> Result<()> {
    Entry::new(SERVICE, email)?.delete_password()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_load_delete() {
        let email = "keychain_test_unit@tssi.it";
        store_password(email, "secret123").unwrap();
        let loaded = load_password(email).unwrap();
        assert_eq!(loaded, "secret123");
        delete_password(email).unwrap();
        assert!(load_password(email).is_err());
    }
}
