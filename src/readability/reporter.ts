import * as path from 'path';
import { AnalysisResult } from './analyzer';

export interface ReadabilityReportOptions {
  format: 'text' | 'json';
  verbose: boolean;
  baseDir: string;
  threshold: number;
}

function relativePath(filePath: string, baseDir: string): string {
  return path.relative(baseDir, filePath);
}

function getGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function generateTextReport(result: AnalysisResult, options: ReadabilityReportOptions): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(' TEST READABILITY SCORE (testla-lens Screenplay) ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  const grade = getGrade(result.overallScore);
  lines.push(
    `📊 Overall Score: ${result.overallScore}/100 (Grade: ${grade}) – weighted for Testla Screenplay best practices`,
  );
  lines.push(` Files analyzed: ${result.totalFiles}`);
  lines.push(` Tests analyzed: ${result.totalTests}`);
  lines.push('');

  if (result.files.length === 0) {
    lines.push('No Playwright test files (*.spec.ts, *.test.ts) found.');
    return lines.join('\n');
  }

  const sortedFiles = [...result.files].sort((a, b) => a.fileScore - b.fileScore);
  const belowThreshold = sortedFiles.filter((f) => f.fileScore < options.threshold);

  if (belowThreshold.length > 0) {
    lines.push(`⚠️ Files below threshold (${options.threshold}):`);
    lines.push('');

    for (const file of belowThreshold) {
      const relPath = relativePath(file.file, options.baseDir);
      lines.push(`┌─ ${relPath}`);
      lines.push(
        `│ Score: ${file.fileScore}/100 | Tests: ${file.testCount} | Lines: ${file.lineCount}`,
      );

      if (file.suggestions.length > 0) {
        lines.push('│');
        for (const suggestion of file.suggestions) {
          lines.push(`│ 💡 ${suggestion}`);
        }
      }

      if (options.verbose) {
        const lowTests = file.tests.filter((t) => t.overallScore < options.threshold);
        if (lowTests.length > 0) {
          lines.push('│');
          lines.push('│ Tests needing attention:');
          for (const test of lowTests) {
            lines.push(`│ • "${test.name}" (line ${test.line}): ${test.overallScore}/100`);
            for (const suggestion of test.suggestions.slice(0, 3)) {
              lines.push(`│   - ${suggestion}`);
            }
          }
        }
      }

      lines.push('└─────────────────────────────────────────────────────────────');
      lines.push('');
    }
  }

  lines.push('📈 Score Dimensions (per test):');
  lines.push('');
  lines.push(' • Test Name (22%): Descriptive, behaviour-focused, uses action verbs');
  lines.push(
    ' • Assertions (25%): 1–5 focused assertions describing observable outcomes (Questions/Expectations)',
  );
  lines.push(' • Nesting (18%): Flat structure, domain logic moved into Screenplay Tasks');
  lines.push(' • Length (20%): 10–30 lines per scenario, longer flows split into Tasks');
  lines.push(
    ' • Screenplay Usage (15%): Actor/Tasks/Questions instead of low-level page.* calls, as in the Testla docs',
  );
  lines.push('');
  lines.push(
    'For details on the Screenplay pattern and best practices see the Testla docs: https://github.com/testla-project/testla-screenplay-playwright-js/tree/main/docs',
  );
  lines.push('');

  return lines.join('\n');
}

function generateJsonReport(result: AnalysisResult, options: ReadabilityReportOptions): string {
  const report = {
    summary: {
      overallScore: result.overallScore,
      grade: getGrade(result.overallScore),
      totalFiles: result.totalFiles,
      totalTests: result.totalTests,
      analyzedAt: new Date().toISOString(),
      threshold: options.threshold,
      basedOn: 'Playwright + Testla Screenplay best practices',
      docs: 'https://github.com/testla-project/testla-screenplay-playwright-js/tree/main/docs',
    },
    files: result.files.map((file) => ({
      path: relativePath(file.file, options.baseDir),
      score: file.fileScore,
      grade: getGrade(file.fileScore),
      lineCount: file.lineCount,
      testCount: file.testCount,
      suggestions: file.suggestions,
      tests: file.tests.map((test) => ({
        name: test.name,
        line: test.line,
        scores: {
          overall: test.overallScore,
          name: test.nameScore,
          assertions: test.assertionScore,
          nesting: test.nestingScore,
          length: test.lengthScore,
          screenplay: test.screenplayScore,
        },
        suggestions: test.suggestions,
      })),
    })),
  };

  return JSON.stringify(report, null, 2);
}

export function generateReadabilityReport(
  result: AnalysisResult,
  options: ReadabilityReportOptions,
): string {
  if (options.format === 'json') {
    return generateJsonReport(result, options);
  }
  return generateTextReport(result, options);
}

