export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
    // The parser starts the footer at any body line opening "word:", so a
    // wrapped sentence warns. Trailers here are a blank-line `Closes <id>`;
    // co-author lines come only from GitHub's squash merge, never this hook.
    'footer-leading-blank': [0, 'always'],
    'header-max-length': [2, 'always', 200],
  },
};
