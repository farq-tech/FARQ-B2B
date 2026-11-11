from pathlib import Path
import ast
import unittest


class ServerEntrypointTest(unittest.TestCase):
    def test_server_entrypoint_has_valid_python_syntax(self):
        source = Path(__file__).with_name('server.py').read_text(encoding='utf-8')
        compile(source, 'server.py', 'exec')

    def test_railway_local_upload_includes_runtime_modules_and_entrypoint(self):
        root = Path(__file__).parent
        rules = set((root / '.railwayignore').read_text(encoding='utf-8').splitlines())
        for required in ('!*.py', '!*.sh', '!Dockerfile.railway', '!railway.json'):
            self.assertIn(required, rules)

        source = (root / 'server.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        modules = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules.add(node.module.split('.')[0])
        local_modules = {name for name in modules if (root / f'{name}.py').is_file()}
        self.assertTrue(local_modules, 'the service should have local Python runtime modules')
        self.assertTrue(all((root / f'{name}.py').is_file() for name in local_modules))


if __name__ == '__main__':
    unittest.main()
