/** RGK Group of Industries departments. Used for demo data and to set up a new database. */
const LIST: [code: string, name: string][] = [
  ['MGMT', 'Management'],
  ['RND', 'R&D (Engineering)'],
  ['MDA', 'Marketing and Data Analysis'],
  ['VE', 'Value Engineering'],
  ['FIN', 'Finance'],
  ['ACC', 'Accounts'],
  ['PROD', 'Production'],
  ['BMBF', 'Bamanbore Foundry'],
  ['MTDF', 'Metoda Foundry'],
  ['GALV4', 'Galvanise Unit-04'],
  ['GLOB5', 'Global Unit-05'],
  ['WELD', 'Welding Cell'],
  ['MACH', 'Machine Shop'],
  ['PUR', 'Purchase'],
  ['VD', 'Vendor Development'],
  ['PPC', 'PPC (Production Planning & Control)'],
  ['STORE', 'Store'],
  ['QA', 'QA (Quality Assurance)'],
  ['QC', 'QC (Quality Check)'],
  ['HR', 'HR & Admin'],
  ['IT', 'IT'],
  ['QMS', 'QMS'],
  ['ADMIN', 'Admin'],
];

export const RGK_DEPARTMENTS: { id: string; code: string; name: string }[] = LIST.map(([code, name]) => ({ id: `dept_${code.toLowerCase()}`, code, name }));
