import ast
import pathlib
import unittest


class DisputeGuardRegressionTest(unittest.TestCase):
    def test_raise_dispute_rejects_any_settled_allocation_before_state_change(self):
        source = pathlib.Path(__file__).with_name("delivera.py").read_text()
        tree = ast.parse(source)
        method = next(
            node for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "raise_dispute"
        )
        statements = [ast.unparse(node) for node in method.body]
        guard_index = next(i for i, text in enumerate(statements) if "settled_atto" in text and "self._require" in text)
        mutation_index = next(i for i, text in enumerate(statements) if "wc.disputes_json.append" in text)
        self.assertLess(guard_index, mutation_index)
        self.assertIn("== 0", statements[guard_index])


if __name__ == "__main__":
    unittest.main()
