"""
CodeBookmark LLM Service
A Flask/FastAPI service that bridges your existing LLM models with the Electron app
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import json
import sys
from pathlib import Path
import threading
import time
from typing import Dict, Optional, List
import argparse

# Import your existing model infrastructure
sys.path.append(str(Path(__file__).resolve().parent))
from model_loader import ModelLoader
from deepseek_model_inference import DeepSeekModelInference
from gemma_model_inference import GemmaModelInference

app = Flask(__name__)
CORS(app)  # Enable CORS for Electron communication

# Global model instance
model_instance = None
model_config = {}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CodeBookmarkLLMService:
    def __init__(self, model_name="deepseek_7b", processor="cpu", model_type="default"):
        """Initialize the LLM service with your existing model infrastructure"""
        self.model_name = model_name
        self.processor = processor
        self.model_type = model_type
        self.model_instance = None
        self.is_ready = False

        # Initialize model in background thread to avoid blocking
        threading.Thread(target=self._load_model, daemon=True).start()

    def _load_model(self):
        """Load the model in background thread"""
        try:
            logger.info(f"Loading {self.model_name} model...")

            # Use your existing ModelLoader
            iLoad = ModelLoader(
                model=self.model_name,
                processor=self.processor,
                model_type=self.model_type
            )

            model_subdirectory = iLoad.model_subdirectory_path
            graphs = iLoad.graphs

            # Load ONNX sessions
            model_sessions = {
                graph_name: iLoad.load_model(graph, htp_performance_mode="sustained_high_performance")
                for graph_name, graph in graphs.items()
                if str(graph).endswith(".onnx")
            }

            tokenizer = next((file for file in graphs.values() if file.endswith("tokenizer.json")), None)
            meta_data = graphs["META_DATA"]

            # Initialize appropriate model
            if "deepseek" in self.model_name.lower():
                self.model_instance = DeepSeekModelInference(
                    model_sessions=model_sessions,
                    tokenizer=tokenizer,
                    model_subdirectory=model_subdirectory,
                    model_meta=meta_data,
                    verbose=0  # Keep quiet for service mode
                )
            elif "gemma" in self.model_name.lower():
                self.model_instance = GemmaModelInference(
                    model_sessions=model_sessions,
                    tokenizer=tokenizer,
                    model_subdirectory=model_subdirectory,
                    model_meta=meta_data
                )
            else:
                raise ValueError(f"Unsupported model: {self.model_name}")

            self.is_ready = True
            logger.info(f"✅ {self.model_name} model loaded successfully!")

        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            self.is_ready = False

    def analyze_code(self, content: str) -> Dict:
        """Analyze code content and return structured data"""
        if not self.is_ready or not self.model_instance:
            return None

        try:
            prompt = f"""Analyze this code snippet and provide a JSON response with:
1. A concise title (max 50 chars)
2. 3-5 relevant tags
3. A brief summary (max 100 chars)  
4. Programming language detected

Code:
{content[:1000]}

Respond only with valid JSON in this format:
{{"title": "...", "tags": ["tag1", "tag2", "tag3"], "summary": "...", "language": "..."}}"""

            # Generate response using your existing inference
            if hasattr(self.model_instance, 'run_inference'):
                response = self.model_instance.run_inference(
                    query=prompt,
                    max_tokens=150,
                    temperature=0.3,
                    top_k=10
                )
            else:
                return None

            # Try to parse JSON response
            try:
                # Extract JSON from response if it contains other text
                import re
                json_match = re.search(r'\{.*\}', response, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                    return result
                else:
                    return None
            except (json.JSONDecodeError, AttributeError):
                return None

        except Exception as e:
            logger.error(f"Error in analyze_code: {e}")
            return None

    def explain_code(self, content: str) -> str:
        """Explain what the code does in simple terms"""
        if not self.is_ready or not self.model_instance:
            return "LLM service not available"

        try:
            prompt = f"""Explain this code in simple terms (max 150 words):

{content[:800]}

Focus on:
- What it does
- Key concepts used  
- When you might use it

Keep it concise and beginner-friendly."""

            response = self.model_instance.run_inference(
                query=prompt,
                max_tokens=200,
                temperature=0.4,
                top_k=15
            )

            return response.strip()

        except Exception as e:
            logger.error(f"Error in explain_code: {e}")
            return "Error explaining code"

    def suggest_optimizations(self, content: str) -> str:
        """Suggest code optimizations"""
        if not self.is_ready or not self.model_instance:
            return "LLM service not available"

        try:
            prompt = f"""Suggest 2-3 quick improvements for this code (max 100 words):

{content[:600]}

Focus on:
- Performance improvements
- Readability enhancements
- Best practices

Be specific and actionable."""

            response = self.model_instance.run_inference(
                query=prompt,
                max_tokens=150,
                temperature=0.3,
                top_k=10
            )

            return response.strip()

        except Exception as e:
            logger.error(f"Error in suggest_optimizations: {e}")
            return "Error generating suggestions"

    def get_related_queries(self, content: str) -> List[str]:
        """Generate related search queries"""
        if not self.is_ready or not self.model_instance:
            return []

        try:
            prompt = f"""Based on this code, suggest 3 related search queries a developer might want:

{content[:400]}

Respond with just the queries, one per line:"""

            response = self.model_instance.run_inference(
                query=prompt,
                max_tokens=80,
                temperature=0.5,
                top_k=20
            )

            # Parse response into list
            queries = [q.strip() for q in response.split('\n') if q.strip() and len(q.strip()) > 5]
            return queries[:3]  # Return max 3 queries

        except Exception as e:
            logger.error(f"Error in get_related_queries: {e}")
            return []

    def semantic_search(self, query: str, bookmarks: List[Dict]) -> List[Dict]:
        """Perform semantic search on bookmarks"""
        if not self.is_ready or not self.model_instance or not bookmarks:
            return bookmarks

        try:
            # Create bookmark summaries for comparison
            bookmark_texts = []
            for i, bookmark in enumerate(bookmarks):
                text = f"{i}: {bookmark.get('title', '')} - {bookmark.get('summary', '')} [{', '.join(bookmark.get('tags', []))}]"
                bookmark_texts.append(text)

            bookmarks_text = '\n'.join(bookmark_texts)

            prompt = f"""Given the search query "{query}", rank these code bookmarks by relevance (0-100 score).
Consider both exact matches and semantic meaning.

Bookmarks:
{bookmarks_text}

Respond with just the bookmark indices in order of relevance (most relevant first):
Example: 3,1,0,2"""

            response = self.model_instance.run_inference(
                query=prompt,
                max_tokens=50,
                temperature=0.2,
                top_k=5
            )

            # Parse response
            try:
                indices = [int(i.strip()) for i in response.split(',') if i.strip().isdigit()]
                indices = [i for i in indices if 0 <= i < len(bookmarks)]

                # Reorder bookmarks based on semantic ranking
                reordered = [bookmarks[i] for i in indices if i < len(bookmarks)]
                remaining = [bookmarks[i] for i in range(len(bookmarks)) if i not in indices]

                return reordered + remaining

            except (ValueError, IndexError):
                return bookmarks

        except Exception as e:
            logger.error(f"Error in semantic_search: {e}")
            return bookmarks


# Initialize service
llm_service = None


# Flask API endpoints
@app.route('/status', methods=['GET'])
def status():
    """Check if LLM service is ready"""
    if llm_service and llm_service.is_ready:
        return jsonify({
            "available": True,
            "model": llm_service.model_name,
            "processor": llm_service.processor
        })
    else:
        return jsonify({
            "available": False,
            "status": "loading" if llm_service else "not_initialized"
        })


@app.route('/analyze', methods=['POST'])
def analyze_code():
    """Analyze code content"""
    try:
        data = request.get_json()
        content = data.get('content', '')

        if not content:
            return jsonify({"error": "No content provided"}), 400

        result = llm_service.analyze_code(content)

        if result:
            return jsonify(result)
        else:
            return jsonify({"error": "Analysis failed"}), 500

    except Exception as e:
        logger.error(f"Error in /analyze: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/explain', methods=['POST'])
def explain_code():
    """Explain code functionality"""
    try:
        data = request.get_json()
        content = data.get('content', '')

        if not content:
            return jsonify({"error": "No content provided"}), 400

        explanation = llm_service.explain_code(content)
        return jsonify({"explanation": explanation})

    except Exception as e:
        logger.error(f"Error in /explain: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/optimize', methods=['POST'])
def suggest_optimizations():
    """Suggest code optimizations"""
    try:
        data = request.get_json()
        content = data.get('content', '')

        if not content:
            return jsonify({"error": "No content provided"}), 400

        suggestions = llm_service.suggest_optimizations(content)
        return jsonify({"suggestions": suggestions})

    except Exception as e:
        logger.error(f"Error in /optimize: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/related', methods=['POST'])
def get_related_queries():
    """Get related search queries"""
    try:
        data = request.get_json()
        content = data.get('content', '')

        if not content:
            return jsonify({"error": "No content provided"}), 400

        queries = llm_service.get_related_queries(content)
        return jsonify({"queries": queries})

    except Exception as e:
        logger.error(f"Error in /related: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/search', methods=['POST'])
def semantic_search():
    """Perform semantic search on bookmarks"""
    try:
        data = request.get_json()
        query = data.get('query', '')
        bookmarks = data.get('bookmarks', [])

        if not query or not bookmarks:
            return jsonify({"error": "Missing query or bookmarks"}), 400

        ranked_bookmarks = llm_service.semantic_search(query, bookmarks)
        return jsonify({"bookmarks": ranked_bookmarks})

    except Exception as e:
        logger.error(f"Error in /search: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="CodeBookmark LLM Service")
    parser.add_argument("--model", type=str, default="deepseek_7b", help="Model name")
    parser.add_argument("--processor", type=str, default="cpu", help="Processor type")
    parser.add_argument("--port", type=int, default=5000, help="Service port")

    args = parser.parse_args()

    # Initialize LLM service
    logger.info("🚀 Starting CodeBookmark LLM Service...")
    llm_service = CodeBookmarkLLMService(
        model_name=args.model,
        processor=args.processor
    )

    # Start Flask server
    app.run(host='127.0.0.1', port=args.port, debug=False)