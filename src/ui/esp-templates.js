/* Cours Albert 3 — modèles d’espaces prêts à l’emploi (entièrement modifiables après création). */
'use strict';

const TEMPLATES = (() => {
  const W = 1600, H = 900;
  const sticky = (x, y, text, fill = '#fef08a', w = 260, h = 200) => ({ type: 'sticky', x, y, w, h, text, style: { fill, fontSize: 24 } });
  const text = (x, y, t, size = 40, w = 900, extra = {}) => ({ type: 'text', x, y, w, h: Math.round(size * 1.6), text: t, style: { fontSize: size, weight: 'bold', color: '#111827', ...extra } });
  const box = (type, x, y, w, h, fill, label = '', extra = {}) => ({ type, x, y, w, h, text: label, style: { fill, stroke: 'none', fontSize: 26, color: '#ffffff', align: 'center', ...extra } });
  const card = (id, title, objects, extra = {}) => ({ id, title, objects, ...extra });
  const post = (title, body, extra = {}) => ({ title, body, ...extra });

  const boards = [
    {
      id: 'brainstorm', kind: 'board', icon: '💡', title: 'Brainstorming', desc: 'Chacun dépose ses idées, puis tout le monde vote pour faire émerger les meilleures.',
      payload: {
        title: 'Brainstorming', icon: '💡', description: 'Une idée par carte. Votez ensuite pour les meilleures !',
        theme: { wallpaper: 'gradient:aurore', accent: '#7c3aed' }, settings: { layout: 'wall', reactions: 'vote', sort: 'manual' },
        posts: [post('La question du jour', 'Comment rendre le campus plus **écologique** ?\nAjoutez une idée avec le bouton **+**.', { color: '#ede9fe' }), post('Exemple d’idée', 'Installer des fontaines à eau pour supprimer les bouteilles en plastique.')],
      },
    },
    {
      id: 'kanban', kind: 'board', icon: '✅', title: 'Kanban', desc: 'Suivez vos tâches de « À faire » à « Terminé » en glissant les cartes.',
      payload: {
        title: 'Suivi de projet', icon: '✅', description: 'Glissez les cartes d’une colonne à l’autre.', theme: { wallpaper: 'pattern:points:#f1f5f9', accent: '#2563eb' },
        settings: { layout: 'columns', sections: true, reactions: 'none' },
        sections: [{ id: 's_todo', title: 'À faire' }, { id: 's_doing', title: 'En cours' }, { id: 's_done', title: 'Terminé' }],
        fields: [{ id: 'f_resp', name: 'Responsable', type: 'user' }, { id: 'f_due', name: 'Échéance', type: 'date' }, { id: 'f_prio', name: 'Priorité', type: 'select', options: [{ id: 'o_h', label: 'Haute', color: '#ef4444' }, { id: 'o_m', label: 'Moyenne', color: '#f59e0b' }, { id: 'o_l', label: 'Basse', color: '#22c55e' }] }],
        posts: [post('Choisir le sujet', 'Se mettre d’accord sur la problématique.', { sectionId: 's_done', fields: { f_prio: 'o_h' } }), post('Collecter les données', '', { sectionId: 's_doing', fields: { f_prio: 'o_m' } }), post('Rédiger la synthèse', '', { sectionId: 's_todo', fields: { f_prio: 'o_l' } })],
      },
    },
    {
      id: 'projet', kind: 'board', icon: '🔬', title: 'Projet de recherche', desc: 'Recherche, Données, Analyse, Résultats, Conclusions : une section par étape.',
      payload: {
        title: 'Projet de recherche', icon: '🔬', theme: { wallpaper: 'gradient:menthe', accent: '#0d9488' }, settings: { layout: 'columns', sections: true, reactions: 'like' },
        sections: ['Recherche', 'Données', 'Analyse', 'Résultats', 'Conclusions'].map((t, i) => ({ id: `s_${i}`, title: t })),
        fields: [{ id: 'f_src', name: 'Source', type: 'url' }, { id: 'f_date', name: 'Date', type: 'date' }],
        posts: [post('Question de recherche', 'Formulez ici la question à laquelle le projet répond.', { sectionId: 's_0' })],
      },
    },
    {
      id: 'portfolio', kind: 'board', icon: '🎨', title: 'Portfolio', desc: 'Présentez vos réalisations en grille, avec date, compétences et lien.',
      payload: {
        title: 'Mon portfolio', icon: '🎨', theme: { wallpaper: 'color:#f5f5f4', accent: '#0f766e', font: 'serif' }, settings: { layout: 'grid', reactions: 'like', showAuthor: false },
        fields: [{ id: 'f_date', name: 'Date', type: 'date' }, { id: 'f_skills', name: 'Compétences', type: 'multiselect', options: ['Analyse', 'Communication', 'Programmation', 'Créativité', 'Gestion de projet'].map((l, i) => ({ id: `o_${i}`, label: l })) }, { id: 'f_link', name: 'Voir le projet', type: 'button', label: 'Voir le projet' }],
        posts: [post('Projet exemple', 'Décrivez le contexte, votre rôle et le résultat. Ajoutez une image de couverture.', { fields: { f_skills: ['o_0', 'o_1'] } })],
      },
    },
    {
      id: 'chronologie', kind: 'board', icon: '🕰️', title: 'Chronologie', desc: 'Racontez une évolution, une roadmap ou une séquence sur une frise.',
      payload: {
        title: 'Chronologie', icon: '🕰️', theme: { wallpaper: 'gradient:sable', accent: '#b45309' }, settings: { layout: 'timeline', sort: 'date', reactions: 'none' },
        posts: [post('Début du projet', 'Lancement et premières recherches.', { eventDate: '2026-09-07' }), post('Étape intermédiaire', 'Premiers résultats.', { eventDate: '2026-10-15' }), post('Présentation finale', 'Soutenance devant le jury.', { eventDate: '2026-12-10' })],
      },
    },
    {
      id: 'carte', kind: 'board', icon: '🗺️', title: 'Carte géographique', desc: 'Épinglez des publications sur des villes et des lieux du monde.',
      payload: {
        title: 'Carte du monde', icon: '🗺️', theme: { wallpaper: 'gradient:ocean', accent: '#0369a1' }, settings: { layout: 'map', reactions: 'like' },
        posts: [post('Paris', 'Capitale de la France.', { location: { lat: 48.857, lng: 2.352, label: 'Paris, France' } }), post('Bruxelles', 'Siège de nombreuses institutions européennes.', { location: { lat: 50.846, lng: 4.352, label: 'Bruxelles, Belgique' } }), post('Rome', 'La Ville éternelle.', { location: { lat: 41.903, lng: 12.496, label: 'Rome, Italie' } }), post('Tokyo', 'Plus grande agglomération du monde.', { location: { lat: 35.687, lng: 139.749, label: 'Tokyo, Japon' } })],
      },
    },
    {
      id: 'planning', kind: 'board', icon: '🗓️', title: 'Planification', desc: 'Une colonne par semaine pour organiser révisions ou rendus.',
      payload: {
        title: 'Planning de révisions', icon: '🗓️', theme: { wallpaper: 'pattern:grille:#f8fafc', accent: '#4f46e5' }, settings: { layout: 'columns', sections: true, reactions: 'none' },
        sections: ['Semaine 1', 'Semaine 2', 'Semaine 3', 'Semaine 4'].map((t, i) => ({ id: `s_${i}`, title: t })),
        fields: [{ id: 'f_due', name: 'Pour le', type: 'date' }, { id: 'f_done', name: 'Fait', type: 'select', options: [{ id: 'o_y', label: 'Oui', color: '#22c55e' }, { id: 'o_n', label: 'Non', color: '#94a3b8' }] }],
        posts: [post('Réviser le chapitre 1', 'Relire les notes puis refaire les exercices.', { sectionId: 's_0' })],
      },
    },
    {
      id: 'questions', kind: 'board', icon: '🙋', title: 'Questions de cours', desc: 'Les participants posent leurs questions et votent pour les plus utiles.',
      payload: {
        title: 'Vos questions', icon: '🙋', description: 'Posez vos questions, votez pour celles que vous voulez voir traitées.', theme: { wallpaper: 'gradient:lavande', accent: '#6d28d9' },
        settings: { layout: 'stream', reactions: 'vote', sort: 'reactions', newPosts: 'start', attribution: 'anonymous' }, posts: [],
      },
    },
    {
      id: 'vocabulaire', kind: 'board', icon: '🔤', title: 'Vocabulaire', desc: 'Un mot par carte avec traduction, exemple et prononciation.',
      payload: {
        title: 'Vocabulaire', icon: '🔤', theme: { wallpaper: 'gradient:peche', accent: '#be123c' }, settings: { layout: 'grid', reactions: 'none', showAuthor: false },
        fields: [{ id: 'f_tr', name: 'Traduction', type: 'text', required: true }, { id: 'f_ex', name: 'Exemple', type: 'text' }, { id: 'f_lvl', name: 'Niveau', type: 'select', options: ['A2', 'B1', 'B2', 'C1'].map((l, i) => ({ id: `o_${i}`, label: l })) }],
        posts: [post('Stakeholder', '', { fields: { f_tr: 'Partie prenante', f_ex: 'We met every stakeholder of the project.', f_lvl: 'o_2' } })],
      },
    },
    {
      id: 'journal', kind: 'board', icon: '📓', title: 'Journal de réflexion', desc: 'Un carnet de bord chronologique pour noter ce que vous apprenez.',
      payload: {
        title: 'Journal de bord', icon: '📓', theme: { wallpaper: 'pattern:papier:#fffbeb', accent: '#92400e', font: 'serif' }, settings: { layout: 'stream', sort: 'newest', newPosts: 'start', reactions: 'none', comments: true },
        fields: [{ id: 'f_mood', name: 'Ressenti', type: 'rating' }],
        posts: [post('Ce que j’ai appris aujourd’hui', '- Une idée nouvelle\n- Une difficulté\n- Une question à poser')],
      },
    },
    {
      id: 'projets-etudiants', kind: 'board', icon: '🗂️', title: 'Projets étudiants', desc: 'Une petite base de données : nom, étudiant, date, catégorie, lien et note.',
      payload: {
        title: 'Projets étudiants', icon: '🗂️', theme: { wallpaper: 'color:#f1f5f9', accent: '#0f172a' }, settings: { layout: 'table', reactions: 'none' },
        fields: [{ id: 'f_student', name: 'Étudiant', type: 'user', required: true }, { id: 'f_date', name: 'Date', type: 'date' }, { id: 'f_cat', name: 'Catégorie', type: 'select', options: ['Data', 'Business', 'Maths', 'Humanités'].map((l, i) => ({ id: `o_${i}`, label: l })) }, { id: 'f_link', name: 'Lien', type: 'url' }, { id: 'f_grade', name: 'Note', type: 'score', max: 20 }],
        posts: [post('Analyse des ventes', 'Tableau de bord des ventes d’une PME.', { fields: { f_student: 'Inès', f_cat: 'o_0', f_grade: 16 } })],
      },
    },
    {
      id: 'ressources', kind: 'board', icon: '📚', title: 'Bibliothèque de ressources', desc: 'Articles, vidéos et outils classés par type, catégorie et importance.',
      payload: {
        title: 'Ressources', icon: '📚', theme: { wallpaper: 'gradient:foret', accent: '#15803d' }, settings: { layout: 'table', reactions: 'like' },
        fields: [{ id: 'f_type', name: 'Type', type: 'select', options: ['Article', 'Vidéo', 'Livre', 'Site', 'Outil'].map((l, i) => ({ id: `o_${i}`, label: l })) }, { id: 'f_author', name: 'Auteur', type: 'text' }, { id: 'f_url', name: 'URL', type: 'url' }, { id: 'f_imp', name: 'Importance', type: 'rating' }],
        posts: [],
      },
    },
    {
      id: 'presentation', kind: 'board', icon: '🎤', title: 'Présentation', desc: 'Préparez des diapositives sous forme de publications, puis présentez en plein écran.',
      payload: {
        title: 'Ma présentation', icon: '🎤', theme: { wallpaper: 'gradient:nuit', accent: '#818cf8' }, settings: { layout: 'stream', reactions: 'none', showAuthor: false, showDate: false },
        posts: [post('Introduction', 'Le contexte et la problématique.'), post('Développement', '- Premier argument\n- Deuxième argument'), post('Conclusion', 'Ce qu’il faut retenir.')],
      },
    },
    {
      id: 'revision', kind: 'board', icon: '🧠', title: 'Révision d’examen', desc: 'Fiches, exercices et questions pour préparer un examen à plusieurs.',
      payload: {
        title: 'Révisions', icon: '🧠', theme: { wallpaper: 'gradient:ocean', accent: '#1d4ed8' }, settings: { layout: 'columns', sections: true, reactions: 'stars' },
        sections: ['Fiches de cours', 'Exercices', 'Questions', 'Pièges à éviter'].map((t, i) => ({ id: `s_${i}`, title: t })),
        posts: [post('Formule à retenir', '$$\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$$', { sectionId: 's_0' })],
      },
    },
  ];

  const canvases = [
    { id: 'blanc', kind: 'canvas', icon: '🎨', title: 'Tableau blanc', desc: 'Une page vierge pour dessiner, écrire et coller des notes.', payload: { title: 'Tableau blanc', icon: '🎨', cards: [card('k_1', 'Carte 1', [])] } },
    {
      id: 'quiz', kind: 'canvas', icon: '❓', title: 'Quiz interactif', desc: 'Des réponses cliquables qui mènent à d’autres cartes : quiz, escape game, histoire.',
      payload: {
        title: 'Quiz', icon: '❓', theme: { wallpaper: 'color:#eef2ff', accent: '#4f46e5' }, settings: { canvasMode: 'interact', participantsCanAdd: false },
        cards: [
          card('k_q1', 'Question 1', [text(100, 90, 'Quelle est la capitale de l’Australie ?', 54, 1400), box('rect', 180, 380, 520, 200, '#4f46e5', 'Sydney', { radius: 28, fontSize: 40, action: undefined }), box('rect', 900, 380, 520, 200, '#0d9488', 'Canberra', { radius: 28, fontSize: 40 }), text(100, 700, 'Cliquez sur une réponse (mode Interaction ou Présentation).', 26, 1400, { weight: 'normal', color: '#64748b' })].map((o, i) => i === 1 ? { ...o, action: { type: 'card', target: 'k_bad' } } : i === 2 ? { ...o, action: { type: 'card', target: 'k_good' } } : o)),
          card('k_good', 'Bonne réponse', [text(100, 260, '🎉 Bravo, c’est Canberra !', 70, 1400), { ...box('rect', 600, 560, 400, 130, '#22c55e', 'Recommencer', { radius: 30, fontSize: 34 }), action: { type: 'card', target: 'k_q1' } }], { background: '#dcfce7' }),
          card('k_bad', 'Mauvaise réponse', [text(100, 260, '😕 Raté : Sydney est la plus grande ville, pas la capitale.', 54, 1400), { ...box('rect', 600, 560, 400, 130, '#ef4444', 'Réessayer', { radius: 30, fontSize: 34 }), action: { type: 'card', target: 'k_q1' } }], { background: '#fee2e2' }),
        ],
      },
    },
    {
      id: 'storyboard', kind: 'canvas', icon: '🎬', title: 'Storyboard', desc: 'Six scènes à illustrer et décrire, une par carte.',
      payload: {
        title: 'Storyboard', icon: '🎬', theme: { wallpaper: 'color:#f5f5f4', accent: '#c2410c' },
        cards: Array.from({ length: 6 }, (_, i) => card(`k_s${i + 1}`, `Scène ${i + 1}`, [text(80, 50, `Scène ${i + 1}`, 48, 800), box('rect', 80, 150, 900, 600, '#ffffff', '', { stroke: '#a8a29e', strokeWidth: 3, dash: 'dashed', color: '#78716c' }), sticky(1060, 150, 'Ce qui se passe…', '#fed7aa', 440, 300), sticky(1060, 480, 'Son, dialogue…', '#bfdbfe', 440, 270)])),
      },
    },
    {
      id: 'lecon', kind: 'canvas', icon: '🧑‍🏫', title: 'Leçon', desc: 'Introduction, activité, exercice, conclusion : une carte par étape.',
      payload: {
        title: 'Leçon', icon: '🧑‍🏫', theme: { wallpaper: 'gradient:menthe', accent: '#0f766e' },
        cards: [['Introduction', '#ccfbf1'], ['Activité', '#e0e7ff'], ['Exercice', '#fef9c3'], ['Conclusion', '#fce7f3']].map(([t, bg], i) => card(`k_${i}`, t, [text(100, 80, t, 64, 1200), sticky(100, 260, i === 0 ? 'Objectifs de la séance' : i === 1 ? 'Consigne de l’activité' : i === 2 ? 'Énoncé de l’exercice' : 'Ce qu’il faut retenir', '#ffffff', 600, 400), { ...box('rect', 1260, 760, 260, 90, '#0f766e', i < 3 ? 'Suivant →' : 'Recommencer', { radius: 20, fontSize: 28 }), action: { type: 'card', target: i < 3 ? `k_${i + 1}` : 'k_0' } }], { background: bg })),
      },
    },
    {
      id: 'groupes', kind: 'canvas', icon: '👥', title: 'Travail en groupes', desc: 'Une carte réservée à chaque équipe, puis une mise en commun.',
      payload: {
        title: 'Atelier en groupes', icon: '👥', theme: { wallpaper: 'color:#f8fafc', accent: '#9333ea' }, settings: { groupWork: true, canvasMode: 'edit' },
        groups: [{ id: 'g_a', name: 'Groupe A', color: '#ef4444' }, { id: 'g_b', name: 'Groupe B', color: '#3b82f6' }, { id: 'g_c', name: 'Groupe C', color: '#22c55e' }],
        cards: [card('k_all', 'Consigne', [text(100, 100, 'Consigne pour tous les groupes', 54, 1400), sticky(100, 260, 'Décrivez ici le travail à réaliser.', '#e9d5ff', 700, 360)]),
          ...[['g_a', 'Groupe A', '#fee2e2'], ['g_b', 'Groupe B', '#dbeafe'], ['g_c', 'Groupe C', '#dcfce7']].map(([g, t, bg]) => card(`k_${g}`, t, [text(80, 60, t, 54, 800), sticky(80, 200, 'Nos idées…', '#ffffff', 320, 240)], { groupId: g, background: bg })),
          card('k_bilan', 'Mise en commun', [text(100, 100, 'Mise en commun', 60, 1200)])],
      },
    },
    {
      id: 'mindmap', kind: 'canvas', icon: '🧩', title: 'Carte mentale', desc: 'Une idée centrale et ses branches, reliées par des flèches.',
      payload: {
        title: 'Carte mentale', icon: '🧩', theme: { wallpaper: 'pattern:points:#f8fafc', accent: '#ea580c' },
        cards: [card('k_1', 'Carte mentale', (() => {
          const center = { id: 'o_c', ...box('ellipse', 620, 360, 360, 180, '#ea580c', 'Idée centrale', { fontSize: 34 }) };
          const spots = [[160, 120], [1140, 120], [160, 640], [1140, 640]];
          const nodes = spots.map(([x, y], i) => ({ id: `o_b${i}`, ...box('rect', x, y, 300, 120, '#ffffff', `Branche ${i + 1}`, { color: '#9a3412', stroke: '#ea580c', strokeWidth: 3, radius: 18 }) }));
          const links = nodes.map((n, i) => ({ id: `o_l${i}`, type: 'arrow', x: 0, y: 0, w: 1, h: 1, points: [[0, 0], [1, 1]], from: { id: 'o_c' }, to: { id: n.id }, style: { stroke: '#ea580c', strokeWidth: 4, head: 'end' } }));
          return [center, ...nodes, ...links];
        })())],
      },
    },
  ];
  return { boards, canvases, all: [...boards, ...canvases], get: id => [...boards, ...canvases].find(t => t.id === id) || null };
})();
