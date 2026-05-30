<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Ollama Local LLM Configuration
    |--------------------------------------------------------------------------
    |
    | Ollama runs locally on your machine — no API key required.
    | Download from: https://ollama.com
    | Then run: ollama pull llama3.2
    |
    */

    // URL where Ollama is running (default port 11434)
    'url' => env('OLLAMA_URL', 'http://localhost:11434'),

    // Model to use — options: llama3.2, phi3:mini, mistral, tinyllama
    // llama3.2 (~2GB) is recommended — good quality, fast on most machines
    'model' => env('OLLAMA_MODEL', 'llama3.2'),

    // Seconds to wait for a response before timing out and falling back
    'timeout' => env('OLLAMA_TIMEOUT', 30),
];
