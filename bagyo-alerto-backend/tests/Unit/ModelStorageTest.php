<?php

namespace Tests\Unit;

use App\Services\ModelStorage;
use Phpml\Classification\Ensemble\RandomForest;
use Phpml\Estimator;
use Phpml\Exception\FileException;
use Phpml\Exception\SerializeException;
use Tests\TestCase;

class ModelStorageTest extends TestCase
{
    /** @var list<string> */
    private array $tempFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->tempFiles as $tempFile) {
            if (is_file($tempFile)) {
                unlink($tempFile);
            }
        }

        parent::tearDown();
    }

    public function test_it_saves_and_restores_a_random_forest(): void
    {
        $model = new RandomForest(3);
        $model->train(
            [[0, 0], [0, 1], [1, 0], [1, 1], [10, 10], [10, 11], [11, 10], [11, 11]],
            ['calm', 'calm', 'calm', 'calm', 'storm', 'storm', 'storm', 'storm']
        );

        $input = [[10, 10]];
        $originalPrediction = $model->predict($input)[0];
        $path = $this->tempPath('model-storage-random-forest-');
        $storage = new ModelStorage();

        $storage->saveToFile($model, $path);
        $restored = $storage->restoreFromFile($path);

        $this->assertInstanceOf(Estimator::class, $restored);
        $this->assertSame($originalPrediction, $restored->predict($input)[0]);
    }

    public function test_restore_throws_file_exception_for_a_missing_file(): void
    {
        $path = $this->tempPath('model-storage-missing-');

        $this->expectException(FileException::class);

        (new ModelStorage())->restoreFromFile($path);
    }

    public function test_restore_throws_serialize_exception_for_garbage_content(): void
    {
        $path = $this->tempPath('model-storage-garbage-');
        file_put_contents($path, serialize('garbage'));

        $this->expectException(SerializeException::class);

        (new ModelStorage())->restoreFromFile($path);
    }

    public function test_save_throws_file_exception_for_a_missing_directory(): void
    {
        $directory = sys_get_temp_dir()
            . DIRECTORY_SEPARATOR
            . 'model-storage-missing-directory-'
            . bin2hex(random_bytes(8));
        $path = $directory . DIRECTORY_SEPARATOR . 'model.phpml';

        $this->assertDirectoryDoesNotExist($directory);
        $this->expectException(FileException::class);

        (new ModelStorage())->saveToFile(new RandomForest(1), $path);
    }

    private function tempPath(string $prefix): string
    {
        $path = sys_get_temp_dir()
            . DIRECTORY_SEPARATOR
            . $prefix
            . bin2hex(random_bytes(8));

        $this->tempFiles[] = $path;

        return $path;
    }
}
