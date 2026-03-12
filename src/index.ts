#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeDuplicates } from './duplicate/analyzer';
import { generateDuplicateReport } from './duplicate/reporter';
import { analyzeReadability } from './readability/analyzer';
import { generateReadabilityReport } from './readability/reporter';

const program = new Command();

program
  .name('testla-lens')
  .description(
    'Analyze your Playwright Screenplay suite for duplicate tests and Screenplay-aligned readability (based on Testla docs).',
  )
  .version('1.0.0');

program
  .command('duplicates')
  .argument('[directory]', 'Directory containing test files', '.')
  .option('-t, --threshold <n>', 'Similarity threshold percentage (0-100)', '80')
  .option('-f, --format <fmt>', 'Output format: text or json', 'text')
  .option('-v, --verbose', 'Show detailed signatures for each duplicate pair', false)
  .action(
    (
      directory: string,
      options: { threshold: string; format: 'text' | 'json'; verbose: boolean },
    ) => {
      const dir = path.resolve(directory);
      const threshold = parseInt(options.threshold, 10);

      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        console.error('Error: Threshold must be a number between 0 and 100');
        process.exit(1);
      }

      console.log(`\nAnalyzing tests for duplicates in: ${dir}`);
      console.log(`Similarity threshold: ${threshold}%\n`);

      try {
        const { tests, duplicates } = analyzeDuplicates(dir, threshold);
        const report = generateDuplicateReport(tests, duplicates, {
          format: options.format,
          verbose: options.verbose,
          baseDir: dir,
          threshold,
        });

        console.log(report);

        if (duplicates.length > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    },
  );

program
  .command('readability')
  .argument('[directory]', 'Directory containing test files', '.')
  .option(
    '-t, --threshold <n>',
    'Minimum passing score (0-100, Screenplay-aware)',
    '70',
  )
  .option('-f, --format <fmt>', 'Output format: text or json', 'text')
  .option('-v, --verbose', 'Show individual test details', false)
  .action(
    (
      directory: string,
      options: { threshold: string; format: 'text' | 'json'; verbose: boolean },
    ) => {
      const dir = path.resolve(directory);
      const threshold = parseInt(options.threshold, 10);

      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        console.error('Error: Threshold must be a number between 0 and 100');
        process.exit(1);
      }

      console.log(`\nAnalyzing tests for readability in: ${dir}`);
      console.log(`Passing threshold: ${threshold}\n`);

      try {
        const result = analyzeReadability(dir);
        const report = generateReadabilityReport(result, {
          format: options.format,
          verbose: options.verbose,
          baseDir: dir,
          threshold,
        });

        console.log(report);

        if (result.overallScore < threshold) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    },
  );

program
  .command('all')
  .argument('[directory]', 'Directory containing test files', '.')
  .option(
    '-d, --duplicate-threshold <n>',
    'Similarity threshold for duplicate detection (0-100)',
    '80',
  )
  .option(
    '-r, --readability-threshold <n>',
    'Minimum readability score (0-100, Screenplay-aware)',
    '70',
  )
  .option('-f, --format <fmt>', 'Output format: text or json', 'text')
  .option('-v, --verbose', 'Verbose output for both analyses', false)
  .description('Run both duplicate detection and Screenplay-aware readability analysis.')
  .action(
    (
      directory: string,
      options: {
        duplicateThreshold: string;
        readabilityThreshold: string;
        format: 'text' | 'json';
        verbose: boolean;
      },
    ) => {
      const dir = path.resolve(directory);
      const duplicateThreshold = parseInt(options.duplicateThreshold, 10);
      const readabilityThreshold = parseInt(options.readabilityThreshold, 10);

      if (
        Number.isNaN(duplicateThreshold) ||
        duplicateThreshold < 0 ||
        duplicateThreshold > 100
      ) {
        console.error('Error: duplicate-threshold must be between 0 and 100');
        process.exit(1);
      }
      if (
        Number.isNaN(readabilityThreshold) ||
        readabilityThreshold < 0 ||
        readabilityThreshold > 100
      ) {
        console.error('Error: readability-threshold must be between 0 and 100');
        process.exit(1);
      }

      console.log(`\nRunning testla-lens on: ${dir}\n`);

      try {
        const { tests, duplicates } = analyzeDuplicates(dir, duplicateThreshold);
        const readabilityResult = analyzeReadability(dir);

        if (options.format === 'json') {
          const json = {
            duplicateAnalysis: {
              testsAnalyzed: tests.length,
              duplicatesFound: duplicates.length,
              threshold: duplicateThreshold,
            },
            readabilityAnalysis: {
              overallScore: readabilityResult.overallScore,
              totalFiles: readabilityResult.totalFiles,
              totalTests: readabilityResult.totalTests,
              threshold: readabilityThreshold,
            },
          };
          console.log(JSON.stringify(json, null, 2));
        } else {
          console.log('=== DUPLICATE TEST DETECTOR ===');
          console.log(
            generateDuplicateReport(tests, duplicates, {
              format: 'text',
              verbose: options.verbose,
              baseDir: dir,
              threshold: duplicateThreshold,
            }),
          );

          console.log('\n=== TEST READABILITY SCORE (SCREENPLAY) ===');
          console.log(
            generateReadabilityReport(readabilityResult, {
              format: 'text',
              verbose: options.verbose,
              baseDir: dir,
              threshold: readabilityThreshold,
            }),
          );
        }

        let exitCode = 0;
        if (duplicates.length > 0) exitCode = 1;
        if (readabilityResult.overallScore < readabilityThreshold) exitCode = 1;
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    },
  );

if (require.main === module) {
  program.parse();
}

