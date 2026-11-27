/**
 * Migration Script for Phase 4A.8: Canonical English Story Presentation
 * 
 * Invariant: CANONICAL STORY PRESENTATION LANGUAGE = ENGLISH
 * 
 * Migrates real Stories that have Greek titles/summaries or copied source headlines.
 * Leaves Story IDs, memberships, articleIds, and /articles raw content strictly UNTOUCHED.
 */

import { db } from '../src/firebase';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { Article, ArticleAnalysis, Story } from '../src/types';
import {
  generateCanonicalPresentation,
  isPresentationMigrationRequired,
  detectLanguage,
} from '../src/server/clustering/storyPresentationService';

export interface StoryAuditRecord {
  storyId: string;
  currentTitle: string;
  titleLanguage: 'el' | 'en' | 'other';
  summaryLanguage: 'el' | 'en' | 'other';
  migrationRequired: boolean;
  newTitle?: string;
  newSummary?: string;
}

export async function runStoryPresentationMigration(dryRun: boolean = true): Promise<{
  auditRecords: StoryAuditRecord[];
  migratedCount: number;
}> {
  console.log(`=== RUNNING STORY PRESENTATION MIGRATION (dryRun=${dryRun}) ===`);

  const storiesSnap = await getDocs(collection(db, 'stories'));
  const allStories = storiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Story));
  const realStories = allStories.filter((s) => !(s.isLegacy || /^story-00[1-9]$/.test(s.id)));

  console.log(`Found ${realStories.length} real Stories (out of ${allStories.length} total).`);

  const auditRecords: StoryAuditRecord[] = [];
  let migratedCount = 0;

  for (const story of realStories) {
    // Load member articles and analyses
    const articles: Article[] = [];
    const analyses: ArticleAnalysis[] = [];

    for (const artId of story.articleIds) {
      const artSnap = await getDoc(doc(db, 'articles', artId));
      const anSnap = await getDoc(doc(db, 'articleAnalysis', artId));
      if (artSnap.exists()) articles.push({ id: artId, ...artSnap.data() } as Article);
      if (anSnap.exists()) analyses.push({ articleId: artId, ...anSnap.data() } as ArticleAnalysis);
    }

    const titleLang = detectLanguage(story.canonicalTitle || story.title);
    const summaryLang = detectLanguage(story.summary);
    const needsMigration = isPresentationMigrationRequired(story, articles);

    const record: StoryAuditRecord = {
      storyId: story.id,
      currentTitle: story.canonicalTitle || story.title || '',
      titleLanguage: titleLang,
      summaryLanguage: summaryLang,
      migrationRequired: needsMigration,
    };

    if (needsMigration) {
      console.log(`\nMigrating Story: ${story.id}`);
      console.log(`  Current Title (${titleLang}): ${record.currentTitle}`);

      const presentation = await generateCanonicalPresentation({
        storyId: story.id,
        articles,
        analyses,
        primaryCompanyId: story.primaryCompanyId,
        primaryProductId: story.primaryProductId,
        newsType: story.storyType,
        existingStory: story,
      });

      record.newTitle = presentation.canonicalTitle;
      record.newSummary = presentation.canonicalSummary;

      console.log(`  New English Title: ${record.newTitle}`);
      console.log(`  New English Summary: ${record.newSummary.slice(0, 100)}...`);

      if (!dryRun) {
        const storyRef = doc(db, 'stories', story.id);
        await updateDoc(storyRef, {
          canonicalTitle: presentation.canonicalTitle,
          title: presentation.canonicalTitle,
          summary: presentation.canonicalSummary,
          canonicalSummary: presentation.canonicalSummary,
          presentationLanguage: 'en',
          updatedAt: new Date().toISOString(),
        });
        migratedCount++;
        console.log(`  ✓ Persisted to Firestore`);
      } else {
        migratedCount++;
      }
    } else {
      console.log(`Story ${story.id} is already in English. Skipping.`);
    }

    auditRecords.push(record);
  }

  console.log(`\n=== MIGRATION COMPLETE: ${migratedCount} stories ${dryRun ? 'identified for migration' : 'migrated'} ===`);
  return { auditRecords, migratedCount };
}

if (process.argv[1]?.endsWith('migrate_story_presentation.ts')) {
  const isApply = process.argv.includes('--apply');
  runStoryPresentationMigration(!isApply)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
