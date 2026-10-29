<?php

declare(strict_types=1);

namespace App\Services;

use Phpml\Estimator;
use Phpml\Exception\FileException;
use Phpml\Exception\SerializeException;
use Phpml\ModelManager;

class ModelStorage
{
    public function __construct(
        private readonly ModelManager $modelManager = new ModelManager()
    ) {
    }

    public function saveToFile(Estimator $estimator, string $filepath): void
    {
        if (is_writable(dirname($filepath))) {
            $this->modelManager->saveToFile($estimator, $filepath);

            return;
        }

        $serialized = serialize($estimator);
        if (!isset($serialized[0])) {
            throw new SerializeException(sprintf('Class "%s" cannot be serialized.', gettype($estimator)));
        }

        if (@file_put_contents($filepath, $serialized, LOCK_EX) === false) {
            throw new FileException(sprintf('File "%s" cannot be saved.', basename($filepath)));
        }
    }

    public function restoreFromFile(string $filepath): Estimator
    {
        if (is_readable($filepath)) {
            return $this->modelManager->restoreFromFile($filepath);
        }

        $contents = @file_get_contents($filepath);
        if ($contents === false) {
            throw new FileException(sprintf('File "%s" cannot be opened.', basename($filepath)));
        }

        $object = unserialize($contents);
        if ($object === false || !$object instanceof Estimator) {
            throw new SerializeException(sprintf('"%s" cannot be unserialized.', basename($filepath)));
        }

        return $object;
    }
}
