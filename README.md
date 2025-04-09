# LLMFuncs – Lodash meets LLMs 🤖✨

⚠️ **Warning:** work in progress!

**Describe Data Operations in English, Execute with Confidence.**

[![NPM Version](https://img.shields.io/npm/v/@llmfuncs/funcs?style=flat-square)](https://www.npmjs.com/package/@llmfuncs/funcs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Tired of writing boilerplate JavaScript/TypeScript for common array and object manipulations? Wish you could just *describe* what you want to do? LLMFuncs bridges the gap, allowing you to use natural language instructions, powered by Large Language Models (LLMs), to perform data operations like filtering, safely and efficiently.

## What is this?

* **Natural Language Interface:** Describe complex operations like `"active users with more than 100 points"` in plain English.
* **Data Filtering:** Supports filtering arrays based on natural language predicates.
* **LLM Agnostic:** Bring your own LLM! Supports multiple providers via the simple `Provider` interface. Only Gemini is currently supported out-of-the-box during this proof-of-concept alpha stage.
* **Configurable:** Control batching, parallelism, LLM parameters (temperature, model), and retry logic.

## Installation

```bash
npm install @llmfuncs/funcs
```
## Quick Start

```typescript
import { filter, GeminiProvider, llmfuncsConfig } from '@llmfuncs/funcs';

// 1. Configure the LLM Provider globally
llmfuncsConfig({
  provider: new GeminiProvider(process.env.GEMINI_API_KEY)
});

// 2. Use the natural language functions!
const items = [
  { name: 'Apple', category: 'Fruit', price: 1.2 },
  { name: 'Banana', category: 'Fruit', price: 0.5 },
  { name: 'Laptop', category: 'Electronics', price: 1200 },
  { name: 'Orange', category: 'Fruit', price: 0.8 },
];

// Let the LLM generate the filter logic based on the description
const fruits = await filter(
  items,
  "items that belong to the 'Fruit' category"
);

console.log('Filtered Fruits:', fruits);
// Expected output (approx):
// [
//   { name: 'Apple', category: 'Fruit', price: 1.2 },
//   { name: 'Banana', category: 'Fruit', price: 0.5 },
//   { name: 'Orange', category: 'Fruit', price: 0.8 }
// ]

const cheapItems = await filter(
  items,
  "products costing less than $1.00"
);
console.log('Cheap Items:', cheapItems);
// Expected output (approx):
// [
//   { name: 'Banana', category: 'Fruit', price: 0.5 },
//   { name: 'Orange', category: 'Fruit', price: 0.8 }
// ]

// Find the first expensive item
const expensiveItem = await find(
  items,
  "first item that costs more than $1000"
);
console.log('First Expensive Item:', expensiveItem);
// Expected output:
// { name: 'Laptop', category: 'Electronics', price: 1200 }

```

## License

llmfuncs is released under the [MIT License](LICENSE).