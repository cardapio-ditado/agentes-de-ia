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
      //
      // AVISO, e não erro, de propósito: é um mapa de onde o código está mais
      // perigoso de mexer, não um portão. Nenhuma das 57 funções que já
      // estavam aqui barra publicação por causa desta regra.
      complexity: ["warn", 10],
      // `const { id: _id, criado_em: _c, ...copia } = linha` é o jeito da casa
      // de copiar uma linha SEM alguns campos: os nomes tirados existem só
      // para não irem na cópia. Não são variável esquecida.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
);
