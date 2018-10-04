module.exports = {
  "env": {
    "node": true
  },
  "parserOptions": {
    "ecmaVersion": 2018,
    "sourceType": "module"
  },
  "extends": "airbnb-base",
  "rules": {
    "no-multi-spaces": 0,
    "semi": [2, "never"],
    "quotes": ["error", "double"],
    "max-len": ["error", { "code": 200}],
    "comma-dangle": ["error", "never"],
    "arrow-parens": ["error", "as-needed", { "requireForBlockBody": false }]
  }
};
