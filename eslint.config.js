import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
	{
		ignores: ["dist/**", "node_modules/**", "data/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			"no-console": "off",
			"no-undef": "off"
		},
	},
];
