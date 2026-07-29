/**
 * Test script to analyze speech synthesis boundary event timing
 * Run with: node test-speech-timing.js
 */

import { chromium } from 'playwright';

async function testSpeechTiming() {
  console.log('Starting speech timing test...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console logs
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[Speech Debug]')) {
      logs.push({
        text,
        timestamp: Date.now()
      });
      console.log(text);
    }
  });

  try {
    // Navigate to the app
    console.log('Navigating to app...');
    await page.goto('http://localhost:4000');
    await page.waitForLoadState('networkidle');

    // Wait for the app to load
    await page.waitForTimeout(2000);
    console.log('App loaded\n');

    // Take a screenshot to see what's on the page
    await page.screenshot({ path: '/tmp/app-loaded.png' });
    console.log('Screenshot saved to /tmp/app-loaded.png');

    // Find and click a book from the catalog
    console.log('Selecting a book...');
    const bookCard = page.locator('[data-testid="book-card"]').first();
    if (await bookCard.count() === 0) {
      // Try alternative selectors
      const bookElements = await page.locator('button, div').filter({ hasText: /^[A-Z]/ }).all();
      if (bookElements.length > 0) {
        await bookElements[0].click();
      } else {
        throw new Error('No books found in catalog');
      }
    } else {
      await bookCard.click();
    }

    // Wait for book text to load
    await page.waitForTimeout(2000);
    console.log('Book loaded\n');

    // Find and click the Play button
    console.log('Starting speech...');
    const playButton = page.locator('button:has-text("Play")');
    await playButton.click();
    console.log('Speech started\n');

    // Wait for 10 seconds to collect timing data
    console.log('Collecting timing data for 10 seconds...\n');
    await page.waitForTimeout(10000);

    // Stop the speech
    const pauseButton = page.locator('button:has-text("Reading"), button:has-text("Pause")');
    if (await pauseButton.count() > 0) {
      await pauseButton.click();
    }

    console.log('\n=== ANALYSIS ===\n');

    // Parse and analyze the logs
    const boundaryEvents = logs.filter(log => log.text.includes('onboundary fired'));
    const highlightCalls = logs.filter(log => log.text.includes('highlightByCharIndex called'));

    console.log(`Total boundary events: ${boundaryEvents.length}`);
    console.log(`Total highlight calls: ${highlightCalls.length}`);

    if (boundaryEvents.length > 0) {
      console.log('\nFirst 5 boundary events:');
      boundaryEvents.slice(0, 5).forEach((log, i) => {
        console.log(`${i + 1}. ${log.text}`);
      });

      // Extract timing data
      console.log('\n=== Boundary Event Analysis ===');
      const eventData = boundaryEvents.map(log => {
        const match = log.text.match(/name: (\w+|null|undefined),.*charIndex: (\d+),.*elapsedTime: ([\d.]+)/);
        if (match) {
          return {
            name: match[1],
            charIndex: parseInt(match[2]),
            elapsedTime: parseFloat(match[3])
          };
        }
        return null;
      }).filter(Boolean);

      if (eventData.length > 1) {
        const timeBetweenEvents = [];
        for (let i = 1; i < Math.min(eventData.length, 10); i++) {
          const diff = eventData[i].elapsedTime - eventData[i-1].elapsedTime;
          timeBetweenEvents.push(diff);
        }

        const avgTime = timeBetweenEvents.reduce((a, b) => a + b, 0) / timeBetweenEvents.length;
        console.log(`Average time between events: ${avgTime.toFixed(0)}ms`);
        console.log(`Event names: ${[...new Set(eventData.map(d => d.name))].join(', ')}`);
        console.log(`Events firing every ~${(avgTime / 1000).toFixed(2)}s`);
        console.log(`Estimated words per second: ${(1000 / avgTime).toFixed(2)}`);
      }
    }

    if (highlightCalls.length > 0) {
      console.log('\n=== Highlight Analysis ===');
      console.log('First 5 highlight calls:');
      highlightCalls.slice(0, 5).forEach((log, i) => {
        console.log(`${i + 1}. ${log.text}`);
      });
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

testSpeechTiming().catch(console.error);
