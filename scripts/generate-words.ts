import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Difficulty = 'easy' | 'medium' | 'hard';

interface WordEntry {
  id?: string;
  answer: string;
  clue: string;
  category: string;
  difficulty: Difficulty;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let count = 10;
  let topic = '';
  let name = '';
  let difficulty: Difficulty | undefined;
  let isDryRun = false;
  let showHelp = false;

  const validDifficulties = new Set<string>(['easy', 'medium', 'hard']);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--count' || arg === '-n') {
      count = Number.parseInt(args[++i], 10) || 10;
    } else if (arg === '--topic' || arg === '-t') {
      topic = args[++i] || '';
    } else if (arg === '--name') {
      name = args[++i] || '';
    } else if (arg === '--difficulty' || arg === '-d') {
      const val = (args[++i] || '').toLowerCase();
      if (validDifficulties.has(val)) {
        difficulty = val as Difficulty;
      } else {
        console.error(`❌ Dificultad inválida '${val}'. Debe ser una de: easy, medium, hard.`);
        process.exit(1);
      }
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    }
  }

  return { count, topic, name, difficulty, isDryRun, showHelp };
}

function normalizeAnswer(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getExistingStateFromMigrations(): {
  existingAnswers: Set<string>;
  maxIdNum: number;
  nextMigrationNum: number;
} {
  const migrationsDir = join(process.cwd(), 'migrations');
  console.log(`🔍 Escaneando archivos de migración en ${migrationsDir}...`);

  const existingAnswers = new Set<string>();
  let maxIdNum = 0;
  let maxMigrationNum = 0;

  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

    for (const file of files) {
      const matchFile = file.match(/^(\d{4})_/);
      if (matchFile) {
        const num = Number.parseInt(matchFile[1], 10);
        if (num > maxMigrationNum) maxMigrationNum = num;
      }

      const content = readFileSync(join(migrationsDir, file), 'utf-8');

      const regex = /\('w(\d+)',\s*'([^']+)'/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const idNum = Number.parseInt(match[1], 10);
        if (idNum > maxIdNum) maxIdNum = idNum;

        const answer = match[2];
        if (answer) {
          existingAnswers.add(normalizeAnswer(answer));
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Error al leer directorio de migraciones:', err);
  }

  try {
    const output = execSync(
      'npx wrangler d1 execute crossword-futbol-words --local --command "SELECT id, answer FROM words;" --json',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(output);
    const results: Array<{ id: string; answer: string }> = parsed[0]?.results || [];

    for (const row of results) {
      if (row.answer) existingAnswers.add(normalizeAnswer(row.answer));
      if (row.id) {
        const match = row.id.match(/^w(\d+)$/i);
        if (match) {
          const num = Number.parseInt(match[1], 10);
          if (num > maxIdNum) maxIdNum = num;
        }
      }
    }
  } catch {
    // Optional local D1 check
  }

  console.log(
    `✅ ${existingAnswers.size} palabras encontradas. Último ID de palabra: w${maxIdNum}. Próxima migración: ${String(
      maxMigrationNum + 1,
    ).padStart(4, '0')}`,
  );

  return {
    existingAnswers,
    maxIdNum,
    nextMigrationNum: maxMigrationNum + 1,
  };
}

function fetchBatchFromAI(
  batchCount: number,
  topic: string,
  difficulty: Difficulty | undefined,
  existingAnswers: Set<string>,
): WordEntry[] {
  const sampleAnswers = Array.from(existingAnswers).slice(-50);
  const existingList = sampleAnswers.join(', ');
  const topicInstruction = topic ? `El tema o enfoque principal debe ser: "${topic}".` : '';

  const difficultyInstruction = difficulty
    ? `- DIFICULTAD OBLIGATORIA: Genera ÚNICAMENTE preguntas con nivel de dificultad estrictamente: '${difficulty}'.`
    : `- VARIACIÓN DE DIFICULTAD: Asegura un balance variado entre los 3 niveles de dificultad ('easy', 'medium', 'hard').`;

  const prompt = `Eres un experto en fútbol mundial y juegos de trivia para crucigramas.
Genera ${batchCount} preguntas/palabras de trivia de fútbol totalmente NUEVAS.

REGLAS DE DIVERSIDAD Y BALANCE:
- VARIACIÓN DE CATEGORÍAS: Distribuye las preguntas de forma equilibrada entre las distintas categorías disponibles ('jugadores', 'selecciones', 'terminos', 'torneos', 'premios', 'clubes'). NO generes únicamente jugadores.
${difficultyInstruction}

REGLAS ESTRUCTURALES Y FORMATO:
- ${topicInstruction}
- La respuesta ('answer') debe ser una sola palabra o apellido o término (en MAYÚSCULA, SIN acentos, SIN espacios, solo letras A-Z). Ejemplo: 'VINICIUS', 'NEUER', 'BARRABRAVA', 'CHAMPIONS'.
- Longitud de 'answer': entre 3 y 15 letras.
- NO incluyas ninguna de estas palabras recientemente añadidas: [${existingList}].
- La pista ('clue') debe ser clara, entretenida y precisa en español.
- 'category' debe ser estrictamente una de: 'jugadores', 'selecciones', 'terminos', 'torneos', 'premios', 'clubes'.
- 'difficulty' debe ser estrictamente ${difficulty ? `'${difficulty}'` : "una de: 'easy', 'medium', 'hard'"}.

Responde ÚNICAMENTE con un JSON raw (array de objetos sin formato markdown alrededor, o dentro de un bloque json). Ejemplo:
[
  { "answer": "HAALAND", "clue": "Delantero noruego apodado el Androide", "category": "jugadores", "difficulty": "${
    difficulty || 'easy'
  }" }
]`;

  // Note: Pass --dangerously-skip-permissions to agy to prevent non-interactive permission block
  const rawOutput = execSync(`agy -p ${JSON.stringify(prompt)} --dangerously-skip-permissions`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const jsonMatch = rawOutput.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) {
    throw new Error(`Respuesta de IA no contuvo un JSON válido:\n${rawOutput}`);
  }

  const items: WordEntry[] = JSON.parse(jsonMatch[0]);
  return items;
}

function main() {
  const { count, topic, name, difficulty, isDryRun, showHelp } = parseArgs();

  if (showHelp) {
    console.log(`
Uso: pnpm run words:ai [opciones]

Opciones:
  --count, -n <numero>            Número de palabras a generar (por defecto: 10)
  --topic, -t <texto>             Tema específico (ej. "Champions League", "Mundiales", "Copa América")
  --difficulty, -d <easy|medium|hard>  Filtrar para generar solo una dificultad específica
  --name <nombre>                 Sufijo personalizado para la migración (ej. "words_hard")
  --dry-run                       Simular la generación sin crear el archivo de migración
  --help, -h                      Mostrar este mensaje de ayuda
`);
    process.exit(0);
  }

  const { existingAnswers, maxIdNum, nextMigrationNum } = getExistingStateFromMigrations();

  console.log(`🤖 Solicitando un total de ${count} nuevas preguntas con IA (Antigravity agy)...`);
  if (topic) console.log(`🎯 Tema especificado: "${topic}"`);
  if (difficulty) console.log(`⚡ Dificultad fija requerida: "${difficulty}"`);

  const validEntries: WordEntry[] = [];
  let nextId = maxIdNum + 1;
  const validCategories = new Set(['jugadores', 'selecciones', 'terminos', 'torneos', 'premios', 'clubes']);

  const BATCH_SIZE = 15;
  let batchIndex = 1;
  let attempts = 0;
  const maxAttempts = Math.ceil(count / BATCH_SIZE) * 3 + 2;

  while (validEntries.length < count && attempts < maxAttempts) {
    attempts++;
    const needed = count - validEntries.length;
    const currentBatchSize = Math.min(needed, BATCH_SIZE);

    console.log(
      `\n🔄 Lote ${batchIndex++}: Generando ${currentBatchSize} preguntas (${validEntries.length}/${count} completadas)...`,
    );

    try {
      const rawEntries = fetchBatchFromAI(currentBatchSize, topic, difficulty, existingAnswers);

      for (const entry of rawEntries) {
        if (validEntries.length >= count) break;

        const normalized = normalizeAnswer(entry.answer);

        if (!normalized || normalized.length < 3 || normalized.length > 16) {
          console.warn(`⚠️ Omitida respuesta no válida '${entry.answer}'`);
          continue;
        }

        if (existingAnswers.has(normalized)) {
          console.warn(`⚠️ Omitida respuesta duplicada '${normalized}'`);
          continue;
        }

        existingAnswers.add(normalized);

        const category = validCategories.has(entry.category) ? entry.category : 'jugadores';
        const entryDiff: Difficulty =
          difficulty ||
          (entry.difficulty && ['easy', 'medium', 'hard'].includes(entry.difficulty)
            ? entry.difficulty
            : 'medium');
        const id = `w${String(nextId++).padStart(2, '0')}`;

        validEntries.push({
          id,
          answer: normalized,
          clue: entry.clue.trim(),
          category,
          difficulty: entryDiff,
        });
      }
    } catch (err) {
      console.warn(`⚠️ Error en lote ${batchIndex - 1}:`, err instanceof Error ? err.message : err);
    }
  }

  if (validEntries.length === 0) {
    console.log('❌ No se generaron palabras válidas o todas eran duplicadas.');
    process.exit(1);
  }

  console.log(`\n✨ Se generaron ${validEntries.length} palabras válidas exitosamente:`);
  console.table(
    validEntries.map((e) => ({
      ID: e.id,
      Palabra: e.answer,
      Categoría: e.category,
      Dificultad: e.difficulty,
      Pista: e.clue,
    })),
  );

  if (isDryRun) {
    console.log('\n🧪 [DRY-RUN] No se creó ningún archivo de migración.');
    return;
  }

  const escapeSql = (str: string) => str.replace(/'/g, "''");

  const valuesSql = validEntries
    .map(
      (e) =>
        `  ('${e.id}', '${escapeSql(e.answer)}', '${escapeSql(e.clue)}', '${escapeSql(e.category)}', '${escapeSql(
          e.difficulty,
        )}')`,
    )
    .join(',\n');

  const sqlContent = `INSERT INTO words (id, answer, clue, category, difficulty) VALUES\n${valuesSql};\n`;

  const migrationPrefix = String(nextMigrationNum).padStart(4, '0');
  const slugPart = name
    ? slugify(name)
    : topic
    ? `ai_${slugify(topic)}`
    : difficulty
    ? `ai_${difficulty}_words`
    : 'ai_words';
  const fileName = `${migrationPrefix}_${slugPart}.sql`;
  const filePath = join(process.cwd(), 'migrations', fileName);

  writeFileSync(filePath, sqlContent, 'utf-8');

  console.log(`\n📄 Archivo de migración creado exitosamente:\n   └─ migrations/${fileName}`);
  console.log('\n🚀 Para aplicar esta migración a tu base de datos D1:');
  console.log(`   └─ Local:  npx wrangler d1 migrations apply crossword-futbol-words --local`);
  console.log(`   └─ Remoto: npx wrangler d1 migrations apply crossword-futbol-words --remote`);
}

main();
