<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add composite indexes on evacuation_logs that the occupancy and overview
     * queries rely on.  We check for existence first so re-running is safe.
     */
    public function up(): void
    {
        Schema::table('evacuation_logs', function (Blueprint $table) {
            if (!$this->indexExists('evacuation_logs', 'evacuation_logs_center_type_index')) {
                $table->index(['evacuation_center_id', 'type'], 'evacuation_logs_center_type_index');
            }

            if (!$this->indexExists('evacuation_logs', 'evacuation_logs_center_created_index')) {
                $table->index(['evacuation_center_id', 'created_at'], 'evacuation_logs_center_created_index');
            }
        });
    }

    public function down(): void
    {
        Schema::table('evacuation_logs', function (Blueprint $table) {
            if ($this->indexExists('evacuation_logs', 'evacuation_logs_center_type_index')) {
                $table->dropIndex('evacuation_logs_center_type_index');
            }
            if ($this->indexExists('evacuation_logs', 'evacuation_logs_center_created_index')) {
                $table->dropIndex('evacuation_logs_center_created_index');
            }
        });
    }

    private function indexExists(string $table, string $indexName): bool
    {
        $driver = DB::getDriverName();

        if ($driver === 'sqlite') {
            $indexes = DB::select("PRAGMA index_list(\"{$table}\")");
            foreach ($indexes as $index) {
                if ($index->name === $indexName) {
                    return true;
                }
            }
            return false;
        }

        if ($driver === 'pgsql') {
            // PostgreSQL uses pg_indexes
            $exists = DB::selectOne(
                "SELECT 1 FROM pg_indexes WHERE tablename = ? AND indexname = ?",
                [$table, $indexName]
            );
            return $exists !== null;
        }

        // MySQL / MariaDB
        $dbName = DB::getDatabaseName();
        $exists = DB::selectOne(
            "SELECT 1 FROM information_schema.statistics
             WHERE table_schema = ? AND table_name = ? AND index_name = ?
             LIMIT 1",
            [$dbName, $table, $indexName]
        );

        return $exists !== null;
    }
};
