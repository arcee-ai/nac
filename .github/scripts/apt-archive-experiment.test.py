#!/usr/bin/env python3
"""Source/solver controls for the runnable APT prototype."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode=True
SPEC=importlib.util.spec_from_file_location('experiment',Path(__file__).with_name('apt-archive-experiment.py'))
experiment=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(experiment)


class Resolution(unittest.TestCase):
    def test_current_locked_playwright_requests_include_all_native_targets(self):
        names,tool=experiment.requests(Path('crates/nac-server/web'))
        self.assertEqual(tool['version'],'1.62.1')
        self.assertEqual(len(names),33)
        for name in ('xvfb','fonts-wqy-zenhei','libgbm1','libasound2t64'):
            self.assertIn(name,names)

    def test_native_abi_stays_amd64_and_variant_is_separate(self):
        # Regression for actual first solver failure: amd64v3 is not an ABI.
        probe=object.__new__(experiment.Experiment);calls=[]
        probe.execute=lambda label,args,**kw:calls.append((label,args,kw))
        probe.configure('control')
        config=next(x[2]['input_data'].decode() for x in calls if x[0]=='control-config')
        self.assertIn('APT::Architecture "amd64";',config)
        self.assertIn('APT::Architecture-Variants "amd64v3";',config)
        self.assertNotIn('APT::Architecture "amd64v3";',config)

    def test_solver_requires_complete_supported_closure(self):
        self.assertEqual(experiment.selected('Inst font (1:2 Ubuntu:26.04 [all])\n'),[('font','1:2')])
        for text in ('', 'Remv font [1]\n', 'Inst font:arm64 (1 repo [arm64])\n'):
            with self.subTest(text=text),self.assertRaises(ValueError):experiment.selected(text)

    def test_exact_apt_selected_uri_disambiguates_variant(self):
        def stanza(variant,sha):
            return ('Package: font\nVersion: 1:2\nArchitecture: amd64\n'
                f'Filename: pool/main/f/font/font_2_{variant}.deb\nSize: 10\nSHA256: {sha*64}\n')
        metadata=stanza('amd64','a')+'\n'+stanza('amd64v3','b')
        offers={'font_1%3a2_amd64v3.deb':('pool/main/f/font/font_2_amd64v3.deb',10)}
        pin=experiment.package_pin(metadata,'font','1:2',offers)
        self.assertEqual(pin['SHA256'],'b'*64)
        with self.assertRaises(ValueError):experiment.package_pin(metadata,'font','1:2',{})


if __name__=='__main__':unittest.main()
