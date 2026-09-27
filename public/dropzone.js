document.querySelectorAll('[data-dropzone]').forEach((zone) => {
  const input = zone.querySelector('input[type="file"]');
  const nomEl = zone.querySelector('.dropzone__nom');
  const texteEl = zone.querySelector('.dropzone__texte');

  function afficherFichier() {
    if (input.files && input.files[0]) {
      const f = input.files[0];
      const tailleKo = Math.round(f.size / 1024);
      nomEl.textContent = `${f.name} (${tailleKo} Ko)`;
      texteEl.textContent = 'Fichier sélectionné —';
      zone.classList.add('dropzone--rempli');
    } else {
      nomEl.textContent = '';
      texteEl.textContent = 'Cliquez ou glissez le fichier ici';
      zone.classList.remove('dropzone--rempli');
    }
  }

  input.addEventListener('change', afficherFichier);

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dropzone--survol');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dropzone--survol'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dropzone--survol');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      afficherFichier();
    }
  });
});
