// Certificat auto-signé en dev : doit être posé dans le vrai process (le sandbox Jest ne le transmet pas à fetch).
module.exports = async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
};
