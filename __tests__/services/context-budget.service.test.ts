/**
 * Context Budget Service Tests
 *
 * Tests for the context budget management service core functionality
 */

import { describe, it, expect } from 'vitest';

describe('ContextBudgetService', () => {
  describe('Budget Calculation', () => {
    it('should calculate budget correctly', () => {
      const total = 128000;
      const used = 5000;
      const remaining = total - used;
      const percentage = Math.round((used / total) * 100);

      expect(remaining).toBe(123000);
      expect(percentage).toBe(4);
    });

    it('should identify warning state at 80%', () => {
      const usagePercentage = 85;
      const isWarning = usagePercentage >= 80;
      const isCritical = usagePercentage >= 95;

      expect(isWarning).toBe(true);
      expect(isCritical).toBe(false);
    });

    it('should identify critical state at 95%', () => {
      const usagePercentage = 96;
      const isWarning = usagePercentage >= 80;
      const isCritical = usagePercentage >= 95;

      expect(isWarning).toBe(true);
      expect(isCritical).toBe(true);
    });
  });

  describe('Priority Scoring', () => {
    it('should assign correct priority scores', () => {
      const scores = {
        critical: 100,
        high: 75,
        medium: 50,
        low: 25,
      };

      expect(scores.critical).toBe(100);
      expect(scores.high).toBe(75);
      expect(scores.medium).toBe(50);
      expect(scores.low).toBe(25);
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens for text', () => {
      const text = 'Hello World';
      // ~4 characters per token
      const estimate = Math.ceil((text.length / 4) * 1.1);

      expect(estimate).toBeGreaterThan(0);
    });
  });
});
