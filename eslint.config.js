import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Configuração base do ESLint. Só o recomendado — nenhuma regra própria ainda.
export default tseslint.config(
  {
    // Nada gerado, nada de terceiros e nada de navegador: o TypeScript do
    // servidor é o que este lint cobre.
    ignores: ["dist/**", "node_modules/**", "public/**", "supabase/**", "marketing/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Complexidade ciclomática: quantos caminhos diferentes uma função tem.
      // Acima de 10 ninguém consegue mais ler a função inteira de uma vez, e
      // testar todos os caminhos deixa de ser viável — é onde o bug se esconde.
      complexity: ["error", 10],
    },
  },
);
