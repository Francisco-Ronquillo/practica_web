const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3000);
const inscriptionsFile = process.env.INSCRIPCIONES_FILE
  || path.join(__dirname, 'src', 'data', 'inscripciones.json');
let writeQueue = Promise.resolve();

app.use(express.json({ limit: '10kb' }));

function validateInscription(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'El cuerpo debe ser un objeto JSON.' };
  }

  const { nombre, correo, actividad, descripcion } = body;
  const fields = { nombre, correo, actividad, descripcion };
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return { error: `El campo "${field}" es obligatorio.` };
    }
  }

  if (nombre.trim().length > 80) {
    return { error: 'El nombre no puede superar los 80 caracteres.' };
  }
  if (
    correo.trim().length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())
  ) {
    return { error: 'Ingresa un correo electrónico válido.' };
  }
  if (actividad.trim().length > 120) {
    return { error: 'La actividad no puede superar los 120 caracteres.' };
  }
  if (descripcion.trim().length > 500) {
    return { error: 'La descripción no puede superar los 500 caracteres.' };
  }

  return {
    inscription: {
      nombre: nombre.trim(),
      correo: correo.trim().toLowerCase(),
      actividad: actividad.trim(),
      descripcion: descripcion.trim(),
    },
  };
}

async function readInscriptionsFile() {
  const contents = JSON.parse(await fs.readFile(inscriptionsFile, 'utf8'));
  if (!Array.isArray(contents)) {
    throw new Error('El archivo de inscripciones debe contener una lista JSON.');
  }
  return contents;
}

async function readInscriptions() {
  await writeQueue;
  return readInscriptionsFile();
}

function saveInscription(inscription) {
  const operation = writeQueue.then(async () => {
    const inscriptions = await readInscriptionsFile();
    inscriptions.push(inscription);

    const temporaryFile = `${inscriptionsFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(inscriptions, null, 2), 'utf8');
    await fs.rename(temporaryFile, inscriptionsFile);
    return inscription;
  });

  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

app.get('/', (request, response) => {
  response.send('API de inscripciones. Usa /api/inscripciones.');
});

app.get('/api/inscripciones', async (request, response) => {
  try {
    const inscripciones = await readInscriptions();
    return response.status(200).json({ inscripciones });
  } catch (error) {
    console.error('Error al consultar inscripciones:', error);
    return response.status(500).json({ message: 'No se pudieron consultar las inscripciones.' });
  }
});

app.post('/api/inscripciones', async (request, response) => {
  const validation = validateInscription(request.body);
  if (validation.error) {
    return response.status(400).json({ message: validation.error });
  }

  try {
    const inscripcion = await saveInscription(validation.inscription);
    return response.status(201).json({
      message: 'La inscripción se guardó correctamente.',
      inscripcion,
    });
  } catch (error) {
    console.error('Error al guardar inscripción:', error);
    return response.status(500).json({ message: 'No se pudo guardar la inscripción.' });
  }
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
    return response.status(400).json({ message: 'El cuerpo enviado no es JSON válido.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ message: 'El cuerpo supera el tamaño permitido.' });
  }

  console.error('Error no controlado en el servidor:', error);
  return response.status(500).json({ message: 'Ocurrió un error inesperado.' });
});

async function startServer() {
  await fs.mkdir(path.dirname(inscriptionsFile), { recursive: true });

  try {
    await fs.access(inscriptionsFile);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await fs.writeFile(inscriptionsFile, '[]\n', 'utf8');
  }

  app.listen(port, () => {
    console.log(`Servidor backend escuchando en http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('No se pudo iniciar el servidor:', error);
    process.exitCode = 1;
  });
}

module.exports = { app };
