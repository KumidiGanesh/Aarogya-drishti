#!/usr/bin/env node
'use strict';

// Computes measured binary metrics from independent ground truth and predictions only.
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./validate-manifest');

function auc(rows) {
  const positives = rows.filter((row) => row.label === 1).length;
  const negatives = rows.length - positives;
  if (!positives || !negatives) return null;
  const sorted = [...rows].sort((a, b) => a.probability - b.probability);
  let rankSum = 0;
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].probability === sorted[start].probability) end++;
    const averageRank = (start + 1 + end) / 2;
    rankSum += sorted.slice(start, end).filter((row) => row.label === 1).length * averageRank;
    start = end;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function metrics(rows, threshold = 0.5) {
  if (!rows.length) throw new Error('Evaluation set is empty');
  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0,
    brier = 0;
  for (const row of rows) {
    if (
      ![0, 1].includes(row.label) ||
      !Number.isFinite(row.probability) ||
      row.probability < 0 ||
      row.probability > 1
    ) {
      throw new Error('Each row needs binary label and measured probability in [0, 1]');
    }
    const predicted = row.probability >= threshold ? 1 : 0;
    if (predicted && row.label) tp++;
    else if (predicted) fp++;
    else if (row.label) fn++;
    else tn++;
    brier += (row.probability - row.label) ** 2;
  }
  const div = (n, d) => (d ? n / d : null);
  const sensitivity = div(tp, tp + fn),
    specificity = div(tn, tn + fp);
  const precision = div(tp, tp + fp),
    recall = sensitivity;
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  const bins = Array.from({ length: 10 }, () => []);
  rows.forEach((row) => bins[Math.min(9, Math.floor(row.probability * 10))].push(row));
  const ece = bins.reduce((sum, bin) => {
    if (!bin.length) return sum;
    const confidence = bin.reduce((n, row) => n + row.probability, 0) / bin.length;
    const observed = bin.reduce((n, row) => n + row.label, 0) / bin.length;
    return sum + (bin.length / rows.length) * Math.abs(confidence - observed);
  }, 0);
  return {
    n: rows.length,
    threshold,
    sensitivity,
    specificity,
    precision,
    recall,
    f1,
    auroc: auc(rows),
    false_negative_rate: div(fn, fn + tp),
    false_positive_rate: div(fp, fp + tn),
    brier_score: brier / rows.length,
    calibration_ece_10_bins: ece,
    counts: { tp, tn, fp, fn },
  };
}

function evaluate(entries, metadata) {
  validate(entries);
  if (!metadata?.independent_test || !metadata?.dataset_version || !metadata?.model_version) {
    throw new Error(
      'Evaluation requires independent_test=true plus dataset_version and model_version',
    );
  }
  const rows = entries.filter((row) => row.split === 'test');
  if (rows.some((row) => row.independent_test !== true))
    throw new Error('Every test row must be independently held out');
  const bySubgroup = {};
  for (const row of rows) {
    if (!row.subgroup || typeof row.subgroup !== 'object') continue;
    for (const [key, value] of Object.entries(row.subgroup)) {
      bySubgroup[key] ||= {};
      bySubgroup[key][value] ||= [];
      bySubgroup[key][value].push(row);
    }
  }
  return {
    report_type: 'measured_research_evaluation',
    clinical_validation_status: 'not_established',
    dataset_version: metadata.dataset_version,
    model_version: metadata.model_version,
    evaluated_at: new Date().toISOString(),
    overall: metrics(rows),
    subgroup_performance: Object.fromEntries(
      Object.entries(bySubgroup).map(([key, groups]) => [
        key,
        Object.fromEntries(Object.entries(groups).map(([value, group]) => [value, metrics(group)])),
      ]),
    ),
  };
}

if (require.main === module) {
  try {
    const [input, meta, output] = process.argv.slice(2);
    if (!input || !meta || !output)
      throw new Error('Usage: node evaluate.js <predictions.json> <metadata.json> <report.json>');
    const report = evaluate(
      JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')),
      JSON.parse(fs.readFileSync(path.resolve(meta), 'utf8')),
    );
    fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Wrote measured report: ${output}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { metrics, evaluate };
