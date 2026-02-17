<<<<<<< HEAD
# Leseraum Reader

Ein ruhiger, fokussierter Web-Reader für lange Texte.

Dieser Reader kann für **alle Arten von Texten** verwendet werden.
Er wurde ursprünglich für die **Bibel (LXXDE)** gebaut, ist aber bewusst allgemein nutzbar aufgebaut.

## Struktur

```text
leseraum-github/
├── README.md
└── public/
    ├── index.html
    ├── assets/
    │   ├── css/
    │   │   └── styles.css
    │   └── js/
    │       ├── app.js
    │       └── modules/
    │           ├── carousel.js
    │           └── footnote_cleanup.js
    └── data/
        ├── lxxde_elb_bible_all.json
        └── footnote_rules.json
```

## Lokal starten

```bash
cd public
python3 -m http.server 8080
```

Dann im Browser:

```text
http://localhost:8080
```

## Für andere Texte anpassen

Du kannst das Projekt sehr einfach mit Codex oder Claude Code anpassen:

1. Gib eine URL zu einem Text oder PDF an.
2. Sage, dass die Website auf diese Quelle angepasst werden soll.
3. Lasse Datenformat, Navigation und Darstellung automatisch umbauen.

Beispiel-Prompt:

```text
Passe diesen Reader auf folgende Quelle an: <URL-zum-Text-oder-PDF>.
Übernimm Struktur, Kapitel/Abschnitte und Suche in die bestehende Website.
```

## Hinweise

- Die aktuelle Datenbasis in `public/data/lxxde_elb_bible_all.json` ist die ursprüngliche Bibel-Fassung.
- Für neue Inhalte kannst du dieselbe Reader-UI wiederverwenden und nur Daten + Parser austauschen.
=======
# Leseraum
This app is a customizable web reader for any long-form text, providing structured navigation, search, highlighting, and focus features for an improved reading experience.
>>>>>>> bf21d080df980028018821f8500bb560e1265589
