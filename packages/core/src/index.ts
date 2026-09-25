/**
 * @necroreview/core — everything NecroReview knows, with no server attached.
 *
 * The pipeline (scripts/) writes personas and a fix index into the data
 * directory; the bridge reads them and drives ghosts; the control room renders
 * what the bridge emits. All three share these modules.
 */

export type * from './types.js';

export {
  DataStore,
  defaultStore,
  emptyHallOfFame,
  ensureDir,
  readJson,
  writeJson,
} from './store.js';

export {
  REPO_ROOT,
  env,
  envInt,
  isOfflineForced,
  loadEnv,
} from './env.js';

export {
  agentHarness,
  avatarUrl,
  bridgePort,
  commentPages,
  commitPages,
  dataPaths,
  demoPr,
  ghostCount,
  gitbotUrl,
  repoPath,
  sourceRepo,
  type DataPaths,
} from './paths.js';

export {
  firstSentence,
  isQuestion,
  ngrams,
  safeDate,
  shortDate,
  splitIdentifier,
  stemToken,
  stripMarkdown,
  termFrequency,
  tokenize,
  tokenizeStemmed,
  truncate,
  uniqueTokens,
} from './text.js';

export {
  diffStats,
  dirOf,
  isDocPath,
  isStoryPath,
  isTestPath,
  isTypePath,
  languageOf,
  parseDiff,
  stemOf,
  stemsOf,
} from './diff.js';

export {
  SEVERITY_VOTE,
  VOTE_WEIGHTS,
  councilScore,
  councilVerdict,
  describeVerdict,
  voteCounts,
  voteFromFinding,
} from './council.js';

export {
  FIX_COMMIT_RE,
  buildFixIndex,
  isFixCommit,
  queryFixIndex,
  sharedPatternOf,
  type FixQueryOptions,
} from './fixIndex.js';

export {
  buildFutureYouPersona,
  buildPersona,
  describeTone,
  detectPriorities,
  measureVoice,
  minePhrases,
  pickSamples,
  rankReviewers,
  slugify,
  topPathsOf,
  type BuildPersonaOptions,
  type ReviewerRanking,
} from './persona.js';

export {
  CLEAN_PASS_RULE,
  CHANGELOG_RULE,
  DOC_DRIFT_RULE,
  LINE_RULES,
  MISSING_STORY_RULE,
  MISSING_TEST_RULE,
  collectCandidates,
  composeComment,
  confidenceFor,
  evidenceSentence,
  futureYouFinding,
  ghostFindings,
  personaRankOf,
  personaWatches,
  phraseFor,
  primaryFinding,
  severityForEvidence,
  voteFor,
  type AntiPatternRule,
  type Candidate,
  type GhostFindingOptions,
  type GhostReviewContext,
  type RuleScope,
} from './brain.js';

export {
  botSpecForPersona,
  extractFindingJson,
  personaInstructions,
  proseWithoutJson,
  reviewPrompt,
  seancePrompt,
  type BotSpecOptions,
  type GitBotAgent,
  type GitBotBotInput,
  type GitBotPermissionMode,
} from './ghostPrompt.js';

export {
  citationHistory,
  classifyQuestion,
  parseSeanceCommand,
  retrieveCitations,
  seanceAnswer,
  type QuestionShape,
} from './seance.js';

export {
  applyRun,
  contributionOf,
  entryFor,
  isProphetic,
  leaderboard,
  seedHallOfFame,
} from './hallOfFame.js';
