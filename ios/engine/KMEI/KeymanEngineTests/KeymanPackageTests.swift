//
//  KeymanPackageTests.swift
//  KeymanEngineTests
//
//  Created by Joshua Horton on 6/3/20.
//  Copyright © 2020 SIL International. All rights reserved.
//

import XCTest
@testable import KeymanEngine

class KeymanPackageTests: XCTestCase {
  func testKeyboardPackageExtraction() throws {
    let cacheDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let khmerPackageZip = cacheDirectory.appendingPathComponent("khmer_angkor.zip")
    try FileManager.default.copyItem(at: TestUtils.Keyboards.khmerAngkorKMP, to: khmerPackageZip)

    let destinationFolderURL = cacheDirectory.appendingPathComponent("khmer_angkor")

    // Requires that the source file is already .zip, not .kmp.  It's a ZipUtils limitation.
    do {
      try KeymanPackage.extract(fileUrl: khmerPackageZip, destination: destinationFolderURL, complete: { kmp in
        if let kmp = kmp {
          // Run assertions on the package's kmp.info.
          // Assumes the KMP used for testing here has the same kmp.info used for those tests.
          let kmp_json_testcase = KMPJSONTests()
          kmp_json_testcase.kmp_info_khmer_angkor_assertions(kmp.metadata)

          XCTAssertNotNil(kmp as? KeyboardKeymanPackage, "Keyboard KMP test extraction did not yield a keyboard package!")
          XCTAssertTrue(kmp.isKeyboard(), "Keyboard KMP test extraction did not yield a keyboard package!")

          // extracted ok, test kmp
          XCTAssert(kmp.sourceFolder == destinationFolderURL,
                    "The KMP's reported 'source folder' should match the specified destination folder")
        } else {
          XCTAssert(false, "KeymanPackage.extract failed")
        }
      })
    } catch {
      XCTFail("KeymanPackage.extract failed with error \(error)")
    }
  }

  func testLexicalModelPackageExtraction() throws {
    let cacheDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let mtntZip = cacheDirectory.appendingPathComponent("mtnt.zip")
    try FileManager.default.copyItem(at: TestUtils.LexicalModels.mtntKMP, to: mtntZip)

    let destinationFolderURL = cacheDirectory.appendingPathComponent("mtnt.model")

    // Requires that the source file is already .zip, not .kmp.  It's a ZipUtils limitation.
    do {
      try KeymanPackage.extract(fileUrl: mtntZip, destination: destinationFolderURL, complete: { kmp in
        if let kmp = kmp {
          // Run assertions on the package's kmp.info.
          // Assumes the KMP used for testing here has the same kmp.info used for those tests.
          let kmp_json_testcase = KMPJSONTests()

          // As this test takes place after construction of the LexicalModelPackage,
          // the version will be set accordingly, unlike in the other JSON-related tests.
          kmp_json_testcase.kmp_info_nrc_en_mtnt_assertions(kmp.metadata, version: "0.1.4")

          XCTAssertNotNil(kmp as? LexicalModelKeymanPackage, "Lexical model KMP test extraction yielded a keyboard package!")
          XCTAssertTrue(!kmp.isKeyboard(), "Lexical model KMP test extraction yielded a keyboard package!")

          // extracted ok, test kmp
          XCTAssert(kmp.sourceFolder == destinationFolderURL,
                    "The KMP's reported 'source folder' should match the specified destination folder")
        } else {
          XCTAssert(false, "KeymanPackage.extract failed")
        }
      })
    } catch {
      XCTFail("KeymanPackage.extract failed with error \(error)")
    }
  }

  func testPackageFindResourceMatch() {
    ResourceFileManager.shared.prepareKMPInstall(from: TestUtils.Keyboards.khmerAngkorKMP) { kmp, _ in
      guard let kmp = kmp as? KeyboardKeymanPackage else {
        XCTFail("Incorrect package type loaded for test")
        return
      }
      XCTAssertNotNil(kmp.findResource(withID: TestUtils.Keyboards.khmer_angkor.fullID))
      // This keyboard's not in the specified testing package.
      XCTAssertNil(kmp.findResource(withID: TestUtils.Keyboards.khmer10.fullID))

      // Thanks to our package typing hierarchy, it's impossible to even TRY finding
      // a FullLexicalModelID within a KeyboardKeymanPackage!
    }

    ResourceFileManager.shared.prepareKMPInstall(from: TestUtils.LexicalModels.mtntKMP) { kmp, _ in
      guard let kmp = kmp as? LexicalModelKeymanPackage else {
        XCTFail("Incorrect package type loaded for test")
        return
      }
      XCTAssertNotNil(kmp.findResource(withID: TestUtils.LexicalModels.mtnt.fullID))

      // Thanks to our package typing hierarchy, it's impossible to even TRY finding
      // a FullKeyboardID within a LexicalModelKeymanPackage!
    }
  }
}