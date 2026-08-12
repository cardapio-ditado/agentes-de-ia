import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Copie .env.example para .env e preencha.`,
    );
  }
  return value;
}

export function anthropicConfig() {
  return { apiKey: required("ANTHROPIC_API_KEY") };
}

export function supabaseConfig() {
  return {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
